import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowClockwise,
  Briefcase,
  CalendarCheck,
  CalendarDots,
  CaretLeft,
  CaretRight,
  Car,
  ChartBar,
  Check,
  Clock,
  Coffee,
  DownloadSimple,
  FileCsv,
  FileXls,
  Gear,
  ListBullets,
  PencilSimple,
  Plus,
  Stop,
  Trash,
  UploadSimple,
  UserFocus,
  Warning,
  X,
} from "@phosphor-icons/react";

// Keep the legacy key so installed PWAs retain all existing time entries.
const STORAGE_KEY = "nivao-stundenzettel";
const BACKUP_FORMAT = "nivaox-stundenzettel-backup";
const SUPPORTED_BACKUP_FORMATS = new Set([BACKUP_FORMAT, "nivao-stundenzettel-backup"]);
const APP_BASE_URL = import.meta.env.BASE_URL;
const BACKUP_REMINDER_DAYS = 7;
const BACKUP_OVERDUE_DAYS = 14;

const TYPES = {
  office: {
    label: "Büro",
    shortLabel: "Büro",
    icon: Briefcase,
    work: true,
  },
  customer: {
    label: "Kundentermin",
    shortLabel: "Kunde",
    icon: UserFocus,
    work: true,
  },
  driveActive: {
    label: "Fahrt aktiv",
    shortLabel: "Aktiv fahren",
    icon: Car,
    work: true,
  },
  drivePassive: {
    label: "Fahrt passiv",
    shortLabel: "Passiv fahren",
    icon: Car,
    work: false,
  },
  break: {
    label: "Pause",
    shortLabel: "Pause",
    icon: Coffee,
    work: false,
  },
};

function uid() {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

function localDateKey(timestamp = Date.now()) {
  const date = new Date(timestamp);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function initialState() {
  return {
    settings: {
      dailyTargetMinutes: 480,
      defaultBreakMinutes: 45,
      holidayRegion: "bavaria",
      trackingStartDate: localDateKey(),
      lastBackupAt: null,
    },
    days: {},
  };
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return saved?.settings && saved?.days
      ? {
          ...saved,
          settings: {
            ...initialState().settings,
            ...saved.settings,
          },
        }
      : initialState();
  } catch {
    return initialState();
  }
}

function durationMs(entry, now = Date.now()) {
  return Math.max(0, (entry.end ?? now) - entry.start);
}

function totalMs(entries, predicate, now) {
  return entries
    .filter(predicate)
    .reduce((sum, entry) => sum + durationMs(entry, now), 0);
}

function formatDuration(ms, withSeconds = false) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const base = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  return withSeconds ? `${base}:${String(seconds).padStart(2, "0")}` : `${base} h`;
}

function formatClock(timestamp) {
  return new Intl.DateTimeFormat("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);
}

function formatDate(dateKey, includeWeekday = false) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Intl.DateTimeFormat("de-DE", {
    weekday: includeWeekday ? "long" : undefined,
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(new Date(year, month - 1, day));
}

function toDateTimeLocal(timestamp) {
  const date = new Date(timestamp);
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(timestamp - offset).toISOString().slice(0, 16);
}

function escapeCsv(value) {
  const stringValue = String(value ?? "");
  return `"${stringValue.replaceAll('"', '""')}"`;
}

function downloadFile(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function normalizeState(candidate) {
  if (!candidate || typeof candidate !== "object" || !candidate.settings || !candidate.days || typeof candidate.days !== "object") {
    throw new Error("Die Datei enthält keine gültigen Stundenzettel-Daten.");
  }
  const validTypes = new Set(Object.keys(TYPES));
  const days = {};
  Object.entries(candidate.days).forEach(([dateKey, day]) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || !day || typeof day !== "object") return;
    const entries = Array.isArray(day.entries)
      ? day.entries
          .filter((entry) =>
            entry &&
            validTypes.has(entry.type) &&
            Number.isFinite(entry.start) &&
            (entry.end === null || entry.end === undefined || Number.isFinite(entry.end)),
          )
          .map((entry) => ({
            id: entry.id || uid(),
            type: entry.type,
            start: entry.start,
            end: entry.end ?? null,
          }))
      : [];
    days[dateKey] = {
      entries,
      closedAt: Number.isFinite(day.closedAt) ? day.closedAt : null,
      status: day.status === "vacation" ? "vacation" : undefined,
    };
  });
  return {
    settings: {
      ...initialState().settings,
      dailyTargetMinutes: Number(candidate.settings.dailyTargetMinutes) || 480,
      defaultBreakMinutes: Number(candidate.settings.defaultBreakMinutes) || 45,
      holidayRegion: ["bavaria", "assumption", "augsburg"].includes(candidate.settings.holidayRegion)
        ? candidate.settings.holidayRegion
        : "bavaria",
      trackingStartDate: /^\d{4}-\d{2}-\d{2}$/.test(candidate.settings.trackingStartDate)
        ? candidate.settings.trackingStartDate
        : localDateKey(),
      lastBackupAt: Number.isFinite(candidate.settings.lastBackupAt)
        ? candidate.settings.lastBackupAt
        : null,
    },
    days,
  };
}

function dateFromKey(dateKey) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}

function dateKeyFromParts(year, month, day) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day, 12);
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function holidayMap(year, region) {
  const easter = easterSunday(year);
  const holidays = new Map([
    [dateKeyFromParts(year, 1, 1), "Neujahr"],
    [dateKeyFromParts(year, 1, 6), "Heilige Drei Könige"],
    [localDateKey(addDays(easter, -2).getTime()), "Karfreitag"],
    [localDateKey(addDays(easter, 1).getTime()), "Ostermontag"],
    [dateKeyFromParts(year, 5, 1), "Tag der Arbeit"],
    [localDateKey(addDays(easter, 39).getTime()), "Christi Himmelfahrt"],
    [localDateKey(addDays(easter, 50).getTime()), "Pfingstmontag"],
    [localDateKey(addDays(easter, 60).getTime()), "Fronleichnam"],
    [dateKeyFromParts(year, 10, 3), "Tag der Deutschen Einheit"],
    [dateKeyFromParts(year, 11, 1), "Allerheiligen"],
    [dateKeyFromParts(year, 12, 25), "1. Weihnachtstag"],
    [dateKeyFromParts(year, 12, 26), "2. Weihnachtstag"],
  ]);
  if (region === "assumption" || region === "augsburg") {
    holidays.set(dateKeyFromParts(year, 8, 15), "Mariä Himmelfahrt");
  }
  if (region === "augsburg") {
    holidays.set(dateKeyFromParts(year, 8, 8), "Augsburger Friedensfest");
  }
  return holidays;
}

function calendarInfo(dateKey, settings) {
  const date = dateFromKey(dateKey);
  const weekday = date.getDay();
  const holiday = holidayMap(date.getFullYear(), settings.holidayRegion).get(dateKey) ?? null;
  const weekend = weekday === 0 || weekday === 6;
  return {
    holiday,
    weekend,
    workingDay: !weekend && !holiday,
  };
}

function keysBetween(startKey, endKey) {
  const keys = [];
  const current = dateFromKey(startKey);
  const end = dateFromKey(endKey);
  while (current <= end) {
    keys.push(localDateKey(current.getTime()));
    current.setDate(current.getDate() + 1);
  }
  return keys;
}

function monthDateKeys(monthKey) {
  const [year, month] = monthKey.split("-").map(Number);
  const lastDay = new Date(year, month, 0).getDate();
  return Array.from({ length: lastDay }, (_, index) => dateKeyFromParts(year, month, index + 1));
}

function shiftMonth(monthKey, offset) {
  const [year, month] = monthKey.split("-").map(Number);
  const shifted = new Date(year, month - 1 + offset, 1);
  return `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(monthKey) {
  const [year, month] = monthKey.split("-").map(Number);
  return new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" }).format(new Date(year, month - 1, 1));
}

function backupStatus(lastBackupAt, now = Date.now()) {
  if (!Number.isFinite(lastBackupAt)) {
    return {
      level: "warning",
      needsBackup: true,
      title: "Noch kein Backup erstellt",
      detail: "Sichere deine Daten jetzt und danach mindestens alle 7 Tage.",
    };
  }
  const ageDays = Math.max(0, Math.floor((now - lastBackupAt) / 86400000));
  const date = new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(lastBackupAt);
  if (ageDays >= BACKUP_OVERDUE_DAYS) {
    return {
      level: "overdue",
      needsBackup: true,
      title: `Backup seit ${ageDays} Tagen überfällig`,
      detail: `Letzte Sicherung: ${date}. Erstelle möglichst heute ein neues Backup.`,
    };
  }
  if (ageDays >= BACKUP_REMINDER_DAYS) {
    return {
      level: "warning",
      needsBackup: true,
      title: "Neues Backup empfohlen",
      detail: `Letzte Sicherung: ${date}, vor ${ageDays} Tagen.`,
    };
  }
  return {
    level: "current",
    needsBackup: false,
    title: "Backup ist aktuell",
    detail: ageDays === 0 ? `Letzte Sicherung: heute, ${date}.` : `Letzte Sicherung: ${date}, vor ${ageDays} Tagen.`,
  };
}

function findDayWarnings(day, dateKey, now) {
  if (!day?.entries?.length) return [];
  const warnings = [];
  const sorted = [...day.entries].sort((a, b) => a.start - b.start);
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    if ((previous.end ?? now) > current.start) {
      warnings.push("Phasen überschneiden sich");
      break;
    }
  }
  const active = sorted.find((entry) => !entry.end);
  if (active && durationMs(active, now) > 16 * 3600000) {
    warnings.push("Offene Phase läuft länger als 16 Stunden");
  }
  if (dateKey < localDateKey() && !day.closedAt && !active) {
    warnings.push("Vergangener Tag wurde nicht abgeschlossen");
  }
  return warnings;
}

function dayTotals(day, now, settings, dateKey = localDateKey()) {
  const entries = day?.entries ?? [];
  const work = totalMs(entries, (entry) => TYPES[entry.type]?.work, now);
  const activeDrive = totalMs(entries, (entry) => entry.type === "driveActive", now);
  const passiveDrive = totalMs(entries, (entry) => entry.type === "drivePassive", now);
  const breakTime = totalMs(entries, (entry) => entry.type === "break", now);
  const calendar = calendarInfo(dateKey, settings);
  const tracked = dateKey >= settings.trackingStartDate;
  const target = calendar.workingDay && tracked ? settings.dailyTargetMinutes * 60000 : 0;
  const vacation = day?.status === "vacation" && entries.length === 0 && calendar.workingDay ? target : 0;
  const credited = work + vacation;
  return {
    work,
    vacation,
    credited,
    activeDrive,
    passiveDrive,
    breakTime,
    target,
    balance: credited - target,
    calendar,
  };
}

function BrandHeader({ onSettings }) {
  return (
    <header className="brand-header">
      <img src={`${APP_BASE_URL}assets/nivaox-lockup.png`} alt="NIVAOX AI" />
      <button className="icon-button" onClick={onSettings} aria-label="Einstellungen öffnen">
        <Gear size={25} weight="regular" />
      </button>
    </header>
  );
}

function ActivityButtons({ onSelect, activeType, disabled = false, compact = false, hideActive = false }) {
  return (
    <div className={`activity-grid ${compact ? "is-compact" : ""}`}>
      {Object.entries(TYPES).filter(([key]) => !hideActive || key !== activeType).map(([key, type]) => {
        const Icon = type.icon;
        return (
          <button
            key={key}
            className={`activity-button ${activeType === key ? "is-active" : ""}`}
            onClick={() => onSelect(key)}
            disabled={disabled || activeType === key}
          >
            <Icon size={31} weight={key === "driveActive" ? "fill" : "regular"} />
            <strong>{type.shortLabel}</strong>
          </button>
        );
      })}
    </div>
  );
}

function TodayView({
  day,
  dateKey,
  now,
  settings,
  onStart,
  onStop,
  onSwitch,
  onFinishDay,
  onReopenDay,
  onEditEntry,
  onVacation,
}) {
  const entries = day?.entries ?? [];
  const active = entries.find((entry) => !entry.end);
  const totals = dayTotals(day, now, settings, dateKey);
  const ActiveIcon = active ? TYPES[active.type].icon : Clock;
  const hasDay = entries.length > 0;

  if (!hasDay) {
    if (day?.status === "vacation") {
      return (
        <section className="start-view">
          <div className="vacation-state">
            <CalendarCheck size={42} />
            <span className="eyebrow">URLAUB EINGETRAGEN</span>
            <h1>Heute ist Urlaub.</h1>
            <p>{formatDuration(totals.vacation)} werden als Sollzeit gutgeschrieben.</p>
            <button className="secondary-action" onClick={onVacation}>Urlaub bearbeiten</button>
          </div>
        </section>
      );
    }
    return (
      <section className="start-view">
        <div className="date-line">
          <CalendarDots size={21} />
          <span>{formatDate(localDateKey(), true)}</span>
        </div>
        <div className="start-copy">
          <span className="eyebrow">ARBEITSTAG STARTEN</span>
          <h1>Womit beginnt dein Tag?</h1>
          <p>Die Zeit läuft sofort nach deiner Auswahl.</p>
        </div>
        <ActivityButtons onSelect={onStart} />
        <button className="vacation-action" onClick={onVacation}>
          <CalendarCheck size={21} />
          Urlaub eintragen
        </button>
      </section>
    );
  }

  if (day?.closedAt && !active) {
    return (
      <section className="today-view">
        <div className="closed-state">
          <span className="eyebrow"><Check size={17} weight="bold" />TAG ABGESCHLOSSEN</span>
          <h1>Feierabend.</h1>
          <p>Dein Arbeitstag wurde um {formatClock(day.closedAt)} Uhr beendet.</p>
        </div>
        <div className="overview-block closed-overview">
          <div className="overview-heading">
            <span>HEUTE IM ÜBERBLICK</span>
            <span>{formatClock(entries[0].start)}–{formatClock(day.closedAt)}</span>
          </div>
          <Metric icon={Clock} label="Arbeitszeit heute" note="Büro, Kundentermin, Fahrt aktiv" value={formatDuration(totals.work)} />
          <Metric icon={Car} label="Passive Fahrzeit" note="zählt nicht als Arbeitszeit" value={formatDuration(totals.passiveDrive)} />
          <Metric icon={Coffee} label="Pause" note={`Standard ${settings.defaultBreakMinutes} Min.`} value={formatDuration(totals.breakTime)} />
          <Metric
            icon={ArrowClockwise}
            label="Tagessaldo"
            note="Arbeitszeit minus 8 Stunden"
            value={`${totals.balance >= 0 ? "+" : "−"}${formatDuration(Math.abs(totals.balance))}`}
            accent
          />
          {totals.breakTime < settings.defaultBreakMinutes * 60000 && (
            <div className="break-warning">
              Erfasste Pause unter dem Standard von {settings.defaultBreakMinutes} Minuten. Bei Bedarf über die Zeile unten korrigieren.
            </div>
          )}
          <div className="entry-list">
            {entries.map((entry) => (
              <button key={entry.id} onClick={() => onEditEntry(entry)} className="entry-row">
                <span>{formatClock(entry.start)}</span>
                <strong>{TYPES[entry.type].label}</strong>
                <span>{formatDuration(durationMs(entry, now))}</span>
                <PencilSimple size={17} />
              </button>
            ))}
          </div>
        </div>
        <button className="secondary-action reopen-day" onClick={onReopenDay}>
          <ArrowClockwise size={20} />
          Tag wieder öffnen
        </button>
      </section>
    );
  }

  return (
    <section className={`today-view ${active ? "has-running" : ""}`}>
      {active ? (
        <>
          <div className="running-status">
            <span className="eyebrow">
              <i />
              AKTIVITÄT LÄUFT
            </span>
            <div className="activity-title">
              <ActiveIcon size={54} weight={active.type === "driveActive" ? "fill" : "regular"} />
              <div>
                <h1>{TYPES[active.type].label}</h1>
              </div>
            </div>
            <div className="main-timer">{formatDuration(durationMs(active, now), true)}</div>
            <div className="timer-labels">
              <span>Std.</span>
              <span>Min.</span>
              <span>Sek.</span>
            </div>
          </div>
          <button className="primary-action" onClick={onStop}>
            <Stop size={30} weight="fill" />
            {TYPES[active.type].label} beenden
          </button>
          <div className="section-label">SCHNELLWECHSEL</div>
          <ActivityButtons onSelect={onSwitch} activeType={active.type} compact hideActive />
        </>
      ) : (
        <>
          <div className="paused-state">
            <span className="eyebrow">BEREIT FÜR DIE NÄCHSTE PHASE</span>
            <h1>Was machst du jetzt?</h1>
            <p>Deine bisherige Zeit ist gespeichert.</p>
          </div>
          <ActivityButtons onSelect={onStart} />
          <button className="secondary-action finish-day" onClick={onFinishDay}>
            <Check size={21} weight="bold" />
            Tag abschließen
          </button>
        </>
      )}

      <div className="overview-block">
        <div className="overview-heading">
          <span>HEUTE IM ÜBERBLICK</span>
          <span>{formatClock(entries[0].start)} gestartet</span>
        </div>
        <Metric icon={Clock} label="Arbeitszeit heute" note="Erfasste Arbeitsphasen" value={formatDuration(totals.work)} />
        <Metric icon={ChartBar} label="Sollzeit" note="Tagesziel" value={formatDuration(totals.target)} />
        <Metric icon={Coffee} label="Pause" note={`Standard ${settings.defaultBreakMinutes} Min.`} value={formatDuration(totals.breakTime)} />
        <Metric
          icon={ArrowClockwise}
          label="Saldo"
          note="Arbeitszeit minus Soll"
          value={`${totals.balance >= 0 ? "+" : "−"}${formatDuration(Math.abs(totals.balance))}`}
          accent
        />
        <div className="entry-list">
          {entries.map((entry) => (
            <button key={entry.id} onClick={() => onEditEntry(entry)} className="entry-row">
              <span>{formatClock(entry.start)}</span>
              <strong>{TYPES[entry.type].label}</strong>
              <span>{formatDuration(durationMs(entry, now))}</span>
              <PencilSimple size={17} />
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function Metric({ icon: Icon, label, note, value, accent = false }) {
  return (
    <div className="metric-row">
      <Icon size={27} />
      <div>
        <strong>{label}</strong>
        <span>{note}</span>
      </div>
      <b className={accent ? "accent" : ""}>{value}</b>
    </div>
  );
}

function OverviewView({
  state,
  now,
  selectedMonth,
  onMonthChange,
  onEditEntry,
  onVacation,
  onRemoveVacation,
  onAddEntry,
}) {
  const monthKey = selectedMonth;
  const calendarDays = monthDateKeys(monthKey);
  const todayKey = localDateKey();
  const reportingDays = calendarDays.filter((key) => key <= todayKey || monthKey < todayKey.slice(0, 7));
  const monthTotals = reportingDays.reduce(
    (acc, key) => {
      const totals = dayTotals(state.days[key], now, state.settings, key);
      acc.work += totals.credited;
      acc.target += totals.target;
      acc.balance += totals.balance;
      if (state.days[key]?.status === "vacation") acc.vacationDays += 1;
      return acc;
    },
    { work: 0, target: 0, balance: 0, vacationDays: 0 },
  );
  const currentDate = new Date();
  const weekday = currentDate.getDay() || 7;
  const weekStart = new Date(currentDate);
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(currentDate.getDate() - weekday + 1);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 7);
  const weekKeys = keysBetween(localDateKey(weekStart.getTime()), localDateKey(addDays(weekEnd, -1).getTime()))
    .filter((key) => key <= todayKey);
  const weekValues = weekKeys.reduce((acc, key) => {
    const totals = dayTotals(state.days[key], now, state.settings, key);
    acc.credited += totals.credited;
    acc.target += totals.target;
    return acc;
  }, { credited: 0, target: 0 });
  const warningDays = calendarDays
    .map((key) => ({ key, warnings: findDayWarnings(state.days[key], key, now) }))
    .filter((item) => item.warnings.length);

  return (
    <section className="page-view">
      <div className="page-heading">
        <span className="eyebrow">MONATSÜBERSICHT</span>
        <div className="month-navigation">
          <button className="icon-button" onClick={() => onMonthChange(shiftMonth(monthKey, -1))} aria-label="Vorheriger Monat">
            <CaretLeft size={22} />
          </button>
          <h1>{monthLabel(monthKey)}</h1>
          <button className="icon-button" onClick={() => onMonthChange(shiftMonth(monthKey, 1))} aria-label="Nächster Monat">
            <CaretRight size={22} />
          </button>
        </div>
        {monthKey !== todayKey.slice(0, 7) && (
          <button className="month-today" onClick={() => onMonthChange(todayKey.slice(0, 7))}>Zum aktuellen Monat</button>
        )}
        <div className="overview-actions">
          <button className="vacation-action overview-vacation" onClick={onVacation}>
            <CalendarCheck size={20} />
            Urlaub
          </button>
          <button className="vacation-action overview-vacation" onClick={onAddEntry}>
            <Plus size={20} />
            Phase nachtragen
          </button>
        </div>
      </div>
      <div className="summary-strip">
        <div><span>Gutschrift</span><strong>{formatDuration(monthTotals.work)}</strong></div>
        <div><span>Soll bis heute</span><strong>{formatDuration(monthTotals.target)}</strong></div>
        <div><span>Saldo</span><strong className="accent">{monthTotals.balance >= 0 ? "+" : "−"}{formatDuration(Math.abs(monthTotals.balance))}</strong></div>
      </div>
      {monthKey === todayKey.slice(0, 7) && <div className="week-summary">
        <div>
          <span>AKTUELLE WOCHE</span>
          <strong>{formatDuration(weekValues.credited)} von {formatDuration(weekValues.target)}</strong>
        </div>
        <b className={weekValues.credited >= weekValues.target ? "positive" : "accent"}>
          {weekValues.credited >= weekValues.target ? "+" : "−"}{formatDuration(Math.abs(weekValues.credited - weekValues.target))}
        </b>
      </div>}
      {warningDays.length > 0 && (
        <div className="warning-panel">
          <Warning size={23} weight="fill" />
          <div>
            <strong>{warningDays.length} Tag{warningDays.length === 1 ? "" : "e"} prüfen</strong>
            {warningDays.map(({ key, warnings }) => (
              <span key={key}>{formatDate(key)}: {warnings.join(", ")}</span>
            ))}
          </div>
        </div>
      )}
      <div className="days-list">
        {calendarDays.map((key) => {
          const day = state.days[key];
          const totals = dayTotals(day, now, state.settings, key);
          const hasVacation = day?.status === "vacation" && !day?.entries?.length;
          const specialLabel = hasVacation
            ? "Urlaub"
            : totals.calendar.holiday ?? (totals.calendar.weekend ? "Wochenende" : null);
          const isFuture = key > todayKey;
          const dayWarnings = findDayWarnings(day, key, now);
          return (
            <details className={`day-card ${specialLabel ? "is-special" : ""} ${dayWarnings.length ? "has-warning" : ""}`} key={key}>
              <summary>
                <div>
                  <strong>{formatDate(key, true)}</strong>
                  <span>
                    {dayWarnings.length
                      ? `Prüfen: ${dayWarnings.join(", ")}`
                      : specialLabel ?? (day?.closedAt ? "Abgeschlossen" : day?.entries?.length ? "In Bearbeitung" : isFuture ? "Geplant" : "Werktag")}
                  </span>
                </div>
                <div className="day-total">
                  <strong>{hasVacation ? "Urlaub" : formatDuration(totals.credited)}</strong>
                  {totals.target > 0 && !isFuture && (
                    <span className={totals.balance >= 0 ? "positive" : "accent"}>
                      {totals.balance >= 0 ? "+" : "−"}{formatDuration(Math.abs(totals.balance))}
                    </span>
                  )}
                </div>
              </summary>
              {day?.entries?.length > 0 && <div className="day-entries">
                {day.entries.map((entry) => (
                  <button key={entry.id} onClick={() => onEditEntry(entry, key)}>
                    <span>{formatClock(entry.start)}–{entry.end ? formatClock(entry.end) : "läuft"}</span>
                    <strong>{TYPES[entry.type].label}</strong>
                    <span>{formatDuration(durationMs(entry, now))}</span>
                    <PencilSimple size={16} />
                  </button>
                ))}
              </div>}
              {hasVacation && (
                <div className="day-entries vacation-controls">
                  <button onClick={() => onRemoveVacation(key)}>
                    <X size={16} />
                    <strong>Urlaubstag entfernen</strong>
                  </button>
                </div>
              )}
            </details>
          );
        })}
      </div>
    </section>
  );
}

function ExportView({ state, now, onImportPreview, onBackupCreated }) {
  const importInput = useRef(null);
  const backup = backupStatus(state.settings.lastBackupAt, now);
  const years = new Set([new Date().getFullYear(), ...Object.keys(state.days).map((key) => Number(key.slice(0, 4)))]);
  const calendarDays = [...years].sort().flatMap((year) =>
    keysBetween(dateKeyFromParts(year, 1, 1), dateKeyFromParts(year, 12, 31)),
  );

  const exportRows = () => calendarDays.map((date) => {
    const day = state.days[date];
    const totals = dayTotals(day, now, state.settings, date);
    const phases = (day?.entries ?? []).map((entry) =>
      `${formatClock(entry.start)}-${entry.end ? formatClock(entry.end) : "läuft"} ${TYPES[entry.type].label}`,
    ).join(" | ");
    const dayType = day?.status === "vacation" && !day?.entries?.length
      ? "Urlaub"
      : totals.calendar.holiday ?? (totals.calendar.weekend ? "Wochenende" : "Werktag");
    return {
      Datum: date,
      Wochentag: new Intl.DateTimeFormat("de-DE", { weekday: "long" }).format(dateFromKey(date)),
      Tagestyp: dayType,
      "Arbeitszeit (Std.)": (totals.work / 3600000).toFixed(2).replace(".", ","),
      "Urlaubsgutschrift (Std.)": (totals.vacation / 3600000).toFixed(2).replace(".", ","),
      "Sollzeit (Std.)": (totals.target / 3600000).toFixed(2).replace(".", ","),
      "Saldo (Std.)": (totals.balance / 3600000).toFixed(2).replace(".", ","),
      "Aktive Fahrt (Std.)": (totals.activeDrive / 3600000).toFixed(2).replace(".", ","),
      "Passive Fahrt (Std.)": (totals.passiveDrive / 3600000).toFixed(2).replace(".", ","),
      "Pause (Std.)": (totals.breakTime / 3600000).toFixed(2).replace(".", ","),
      Phasen: phases,
      Status: day?.closedAt ? "Abgeschlossen" : day?.entries?.length ? "In Bearbeitung" : "",
    };
  });

  const downloadCsv = () => {
    const rows = exportRows();
    const headers = Object.keys(rows[0]);
    const content = [
      headers.map(escapeCsv).join(";"),
      ...rows.map((row) => headers.map((header) => escapeCsv(row[header])).join(";")),
    ].join("\r\n");
    downloadFile(`\uFEFF${content}`, `nivaox-stundenzettel-${localDateKey()}.csv`, "text/csv;charset=utf-8");
  };

  const downloadXls = () => {
    const rows = exportRows();
    const headers = Object.keys(rows[0]);
    const table = `
      <table>
        <thead><tr>${headers.map((header) => `<th>${header}</th>`).join("")}</tr></thead>
        <tbody>${rows.map((row) => `<tr>${headers.map((header) => `<td>${row[header]}</td>`).join("")}</tr>`).join("")}</tbody>
      </table>`;
    const html = `<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="UTF-8"></head><body>${table}</body></html>`;
    downloadFile(html, `nivaox-stundenzettel-${localDateKey()}.xls`, "application/vnd.ms-excel");
  };

  const downloadBackup = () => {
    const exportedAt = Date.now();
    const backupState = {
      ...state,
      settings: {
        ...state.settings,
        lastBackupAt: exportedAt,
      },
    };
    const payload = {
      format: BACKUP_FORMAT,
      version: 1,
      exportedAt: new Date(exportedAt).toISOString(),
      data: backupState,
    };
    downloadFile(
      JSON.stringify(payload, null, 2),
      `nivaox-stundenzettel-backup-${localDateKey()}.json`,
      "application/json;charset=utf-8",
    );
    onBackupCreated(exportedAt);
  };

  const readImport = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const candidate = SUPPORTED_BACKUP_FORMATS.has(parsed?.format) ? parsed.data : parsed;
      const normalized = normalizeState(candidate);
      onImportPreview({
        state: normalized,
        filename: file.name,
        dayCount: Object.keys(normalized.days).length,
        entryCount: Object.values(normalized.days).reduce((sum, day) => sum + day.entries.length, 0),
      });
    } catch (error) {
      onImportPreview({ error: error.message || "Die Datei konnte nicht gelesen werden." });
    }
  };

  return (
    <section className="page-view export-view">
      <div className="page-heading">
        <span className="eyebrow">DATENEXPORT</span>
        <h1>Zeiten weiterverarbeiten</h1>
        <p>Der Export enthält jeden Kalendertag mit Arbeitszeit, Urlaub, Wochenende, Feiertag, Sollzeit und Saldo.</p>
      </div>
      <button className="export-card" onClick={downloadCsv}>
        <FileCsv size={37} />
        <div><strong>CSV herunterladen</strong><span>Ideal für Excel, Numbers und weitere Systeme</span></div>
        <DownloadSimple size={22} />
      </button>
      <button className="export-card" onClick={downloadXls}>
        <FileXls size={37} />
        <div><strong>Excel-Datei herunterladen</strong><span>Direkt als Excel-kompatible XLS-Datei öffnen</span></div>
        <DownloadSimple size={22} />
      </button>
      <div className="section-label export-section-label">DATENSICHERUNG</div>
      <div className={`backup-status is-${backup.level}`} role="status">
        {backup.level === "current" ? <Check size={22} weight="bold" /> : <Warning size={22} weight="fill" />}
        <div><strong>{backup.title}</strong><span>{backup.detail}</span></div>
      </div>
      <button className="export-card" onClick={downloadBackup}>
        <DownloadSimple size={37} />
        <div><strong>Backup herunterladen</strong><span>Alle Einstellungen, Zeiten und Urlaubstage als JSON sichern</span></div>
        <DownloadSimple size={22} />
      </button>
      <button className="export-card" onClick={() => importInput.current?.click()}>
        <UploadSimple size={37} />
        <div><strong>Backup wiederherstellen</strong><span>Datei wird zuerst geprüft und als Vorschau gezeigt</span></div>
        <UploadSimple size={22} />
      </button>
      <input ref={importInput} className="visually-hidden" type="file" accept="application/json,.json" onChange={readImport} />
      <div className="privacy-note">
        <Check size={20} weight="bold" />
        <div>
          <strong>Deine Daten bleiben lokal.</strong>
          <span>Die App überträgt keine Zeiten an einen Server. Bei Gerätewechsel, Löschen der Browserdaten oder Entfernen der PWA kann ohne JSON-Backup alles verloren gehen.</span>
        </div>
      </div>
    </section>
  );
}

function Modal({ title, children, onClose }) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="icon-button" onClick={onClose} aria-label="Dialog schließen"><X size={22} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function EditEntryModal({ entry, onSave, onDelete, onClose }) {
  const [type, setType] = useState(entry.type);
  const [start, setStart] = useState(toDateTimeLocal(entry.start));
  const [end, setEnd] = useState(toDateTimeLocal(entry.end ?? Date.now()));

  const save = (event) => {
    event.preventDefault();
    const startMs = new Date(start).getTime();
    const endMs = new Date(end).getTime();
    if (!startMs || !endMs || endMs <= startMs) return;
    onSave({ ...entry, type, start: startMs, end: endMs });
  };

  return (
    <Modal title="Phase korrigieren" onClose={onClose}>
      <form className="modal-form" onSubmit={save}>
        <label>Tätigkeit<select value={type} onChange={(event) => setType(event.target.value)}>
          {Object.entries(TYPES).map(([key, item]) => <option key={key} value={key}>{item.label}</option>)}
        </select></label>
        <label>Beginn<input type="datetime-local" value={start} onChange={(event) => setStart(event.target.value)} /></label>
        <label>Ende<input type="datetime-local" value={end} onChange={(event) => setEnd(event.target.value)} /></label>
        <button className="primary-action compact" type="submit"><Check size={20} />Änderung speichern</button>
        <button className="danger-action" type="button" onClick={() => onDelete(entry)}>
          <Trash size={19} />
          Phase löschen
        </button>
      </form>
    </Modal>
  );
}

function SettingsModal({ settings, onSave, onClose }) {
  const [dailyTarget, setDailyTarget] = useState(settings.dailyTargetMinutes / 60);
  const [defaultBreak, setDefaultBreak] = useState(settings.defaultBreakMinutes);
  const [holidayRegion, setHolidayRegion] = useState(settings.holidayRegion);
  const [trackingStartDate, setTrackingStartDate] = useState(settings.trackingStartDate);
  return (
    <Modal title="Einstellungen" onClose={onClose}>
      <form className="modal-form" onSubmit={(event) => {
        event.preventDefault();
        onSave({
          dailyTargetMinutes: Math.max(0, Number(dailyTarget) * 60),
          defaultBreakMinutes: Math.max(0, Number(defaultBreak)),
          holidayRegion,
          trackingStartDate,
        });
      }}>
        <label>Tägliche Sollzeit in Stunden<input type="number" min="0" max="24" step="0.25" value={dailyTarget} onChange={(event) => setDailyTarget(event.target.value)} /></label>
        <label>Standardpause in Minuten<input type="number" min="0" max="240" step="5" value={defaultBreak} onChange={(event) => setDefaultBreak(event.target.value)} /></label>
        <label>Feiertagsregel<select value={holidayRegion} onChange={(event) => setHolidayRegion(event.target.value)}>
          <option value="bavaria">Bayernweit</option>
          <option value="assumption">Bayern + Mariä Himmelfahrt</option>
          <option value="augsburg">Stadt Augsburg</option>
        </select></label>
        <label>Zeiterfassung ab<input type="date" value={trackingStartDate} onChange={(event) => setTrackingStartDate(event.target.value)} required /></label>
        <p className="form-note">Die Standardpause wird nicht heimlich abgezogen. Du kannst fehlende Minuten bewusst ergänzen.</p>
        <button className="primary-action compact" type="submit"><Check size={20} />Einstellungen speichern</button>
      </form>
    </Modal>
  );
}

function VacationModal({ onSave, onClose }) {
  const today = localDateKey();
  return (
    <Modal title="Urlaub eintragen" onClose={onClose}>
      <form className="modal-form" onSubmit={(event) => {
        event.preventDefault();
        const start = event.currentTarget.elements.vacationStart.value;
        const end = event.currentTarget.elements.vacationEnd.value;
        if (end < start) return;
        onSave(start, end);
      }}>
        <label>Erster Urlaubstag<input name="vacationStart" type="date" defaultValue={today} required /></label>
        <label>Letzter Urlaubstag<input name="vacationEnd" type="date" defaultValue={today} required /></label>
        <p className="form-note">Wochenenden und bayerische Feiertage werden nicht als Urlaubstag gerechnet.</p>
        <button className="primary-action compact" type="submit"><CalendarCheck size={20} />Urlaub speichern</button>
      </form>
    </Modal>
  );
}

function AddEntryModal({ onSave, onClose }) {
  const today = localDateKey();
  return (
    <Modal title="Phase nachtragen" onClose={onClose}>
      <form className="modal-form" onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget.elements;
        const date = form.entryDate.value;
        const start = new Date(`${date}T${form.entryStart.value}`).getTime();
        const end = new Date(`${date}T${form.entryEnd.value}`).getTime();
        if (!date || !start || !end || end <= start) return;
        onSave(date, {
          id: uid(),
          type: form.entryType.value,
          start,
          end,
        });
      }}>
        <label>Datum<input name="entryDate" type="date" defaultValue={today} required /></label>
        <label>Tätigkeit<select name="entryType" defaultValue="office">
          {Object.entries(TYPES).map(([key, item]) => <option key={key} value={key}>{item.label}</option>)}
        </select></label>
        <div className="form-grid">
          <label>Beginn<input name="entryStart" type="time" defaultValue="08:00" required /></label>
          <label>Ende<input name="entryEnd" type="time" defaultValue="09:00" required /></label>
        </div>
        <p className="form-note">Vorhandene Phasen bleiben erhalten. Überschneidungen solltest du anschließend in der Tagesansicht prüfen.</p>
        <button className="primary-action compact" type="submit"><Plus size={20} />Phase speichern</button>
      </form>
    </Modal>
  );
}

function DeleteEntryModal({ entry, onConfirm, onClose }) {
  return (
    <Modal title="Phase wirklich löschen?" onClose={onClose}>
      <div className="confirmation-preview">
        <Warning size={28} weight="fill" />
        <div>
          <strong>{TYPES[entry.type].label}</strong>
          <span>{formatDate(localDateKey(entry.start))}</span>
          <span>{formatClock(entry.start)}–{entry.end ? formatClock(entry.end) : "läuft"}</span>
        </div>
      </div>
      <p className="form-note">Diese Phase wird dauerhaft aus Übersicht und Export entfernt.</p>
      <div className="confirmation-actions">
        <button className="secondary-action compact-button" onClick={onClose}>Abbrechen</button>
        <button className="danger-action solid" onClick={onConfirm}><Trash size={19} />Endgültig löschen</button>
      </div>
    </Modal>
  );
}

function ImportPreviewModal({ preview, onConfirm, onClose }) {
  if (preview.error) {
    return (
      <Modal title="Backup nicht lesbar" onClose={onClose}>
        <div className="warning-panel import-warning">
          <Warning size={23} weight="fill" />
          <div><strong>Import abgebrochen</strong><span>{preview.error}</span></div>
        </div>
        <button className="secondary-action compact-button full-button" onClick={onClose}>Schließen</button>
      </Modal>
    );
  }
  return (
    <Modal title="Backup wiederherstellen?" onClose={onClose}>
      <div className="import-summary">
        <span>Datei</span><strong>{preview.filename}</strong>
        <span>Kalendertage</span><strong>{preview.dayCount}</strong>
        <span>Phasen</span><strong>{preview.entryCount}</strong>
      </div>
      <div className="warning-panel import-warning">
        <Warning size={23} weight="fill" />
        <div>
          <strong>Vorhandene App-Daten werden ersetzt</strong>
          <span>Erstelle vorher ein aktuelles Backup, falls du den jetzigen Stand behalten möchtest.</span>
        </div>
      </div>
      <div className="confirmation-actions">
        <button className="secondary-action compact-button" onClick={onClose}>Abbrechen</button>
        <button className="danger-action solid" onClick={onConfirm}><UploadSimple size={19} />Daten ersetzen</button>
      </div>
    </Modal>
  );
}

export function App() {
  const [state, setState] = useState(loadState);
  const [now, setNow] = useState(Date.now());
  const [view, setView] = useState("today");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [vacationOpen, setVacationOpen] = useState(false);
  const [addEntryOpen, setAddEntryOpen] = useState(false);
  const [deletePending, setDeletePending] = useState(null);
  const [importPreview, setImportPreview] = useState(null);
  const [selectedMonth, setSelectedMonth] = useState(localDateKey().slice(0, 7));
  const todayKey = localDateKey();
  const today = state.days[todayKey];
  const activeSession = Object.entries(state.days)
    .map(([dayKey, day]) => ({
      dayKey,
      entry: day.entries?.find((entry) => !entry.end),
    }))
    .find((session) => session.entry);
  const displayedDayKey = activeSession?.dayKey ?? todayKey;
  const displayedDay = state.days[displayedDayKey];
  const backup = backupStatus(state.settings.lastBackupAt, now);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register(`${APP_BASE_URL}sw.js`, { scope: APP_BASE_URL }).catch(() => {});
    }
  }, []);

  const updateToday = (updater) => {
    setState((current) => {
      const currentDay = current.days[todayKey] ?? { entries: [], closedAt: null };
      return {
        ...current,
        days: {
          ...current.days,
          [todayKey]: updater(currentDay),
        },
      };
    });
  };

  const updateDay = (dayKey, updater) => {
    setState((current) => {
      const currentDay = current.days[dayKey] ?? { entries: [], closedAt: null };
      return {
        ...current,
        days: {
          ...current.days,
          [dayKey]: updater(currentDay),
        },
      };
    });
  };

  const startActivity = (type) => {
    const timestamp = Date.now();
    updateToday((day) => ({
      ...day,
      status: undefined,
      closedAt: null,
      entries: [...day.entries, { id: uid(), type, start: timestamp, end: null }],
    }));
  };

  const stopActivity = () => {
    const timestamp = Date.now();
    const dayKey = activeSession?.dayKey ?? todayKey;
    updateDay(dayKey, (day) => ({
      ...day,
      entries: day.entries.map((entry) => entry.end ? entry : { ...entry, end: timestamp }),
    }));
  };

  const switchActivity = (type) => {
    const timestamp = Date.now();
    setState((current) => {
      const days = { ...current.days };
      if (activeSession) {
        const activeDay = days[activeSession.dayKey];
        days[activeSession.dayKey] = {
          ...activeDay,
          entries: activeDay.entries.map((entry) => entry.end ? entry : { ...entry, end: timestamp }),
        };
      }
      const currentToday = days[todayKey] ?? { entries: [], closedAt: null };
      days[todayKey] = {
        ...currentToday,
        status: undefined,
        closedAt: null,
        entries: [...currentToday.entries, { id: uid(), type, start: timestamp, end: null }],
      };
      return { ...current, days };
    });
  };

  const finishDay = () => {
    const timestamp = Date.now();
    const dayKey = activeSession?.dayKey ?? todayKey;
    updateDay(dayKey, (day) => ({
      ...day,
      closedAt: timestamp,
      entries: day.entries.map((entry) => entry.end ? entry : { ...entry, end: timestamp }),
    }));
  };

  const saveEntry = (updated) => {
    const dayKey = editing.dayKey;
    setState((current) => ({
      ...current,
      days: {
        ...current.days,
        [dayKey]: {
          ...current.days[dayKey],
          entries: current.days[dayKey].entries
            .map((entry) => entry.id === updated.id ? updated : entry)
            .sort((a, b) => a.start - b.start),
        },
      },
    }));
    setEditing(null);
  };

  const deleteEntry = () => {
    if (!deletePending) return;
    const { dayKey, entry } = deletePending;
    setState((current) => ({
      ...current,
      days: {
        ...current.days,
        [dayKey]: {
          ...current.days[dayKey],
          entries: current.days[dayKey].entries.filter((item) => item.id !== entry.id),
        },
      },
    }));
    setDeletePending(null);
    setEditing(null);
  };

  const openEdit = (entry, dayKey = todayKey) => setEditing({ entry, dayKey });

  const saveVacation = (start, end) => {
    setState((current) => {
      const days = { ...current.days };
      keysBetween(start, end).forEach((key) => {
        if (!calendarInfo(key, current.settings).workingDay) return;
        const existing = days[key] ?? { entries: [], closedAt: null };
        if (existing.entries?.length) return;
        days[key] = { ...existing, status: "vacation" };
      });
      return { ...current, days };
    });
    setVacationOpen(false);
  };

  const removeVacation = (dateKey) => {
    setState((current) => ({
      ...current,
      days: {
        ...current.days,
        [dateKey]: {
          ...current.days[dateKey],
          status: undefined,
        },
      },
    }));
  };

  const addEntry = (dateKey, entry) => {
    setState((current) => {
      const day = current.days[dateKey] ?? { entries: [], closedAt: null };
      return {
        ...current,
        days: {
          ...current.days,
          [dateKey]: {
            ...day,
            status: undefined,
            entries: [...day.entries, entry].sort((a, b) => a.start - b.start),
          },
        },
      };
    });
    setAddEntryOpen(false);
  };

  const navigation = useMemo(() => [
    { key: "today", label: "Heute", icon: CalendarDots },
    { key: "overview", label: "Übersicht", icon: ListBullets },
    { key: "export", label: "Export", icon: DownloadSimple },
  ], []);

  return (
    <div className="app-shell">
      <BrandHeader onSettings={() => setSettingsOpen(true)} />
      <main>
        {view === "today" && (
          <TodayView
            day={displayedDay}
            dateKey={displayedDayKey}
            now={now}
            settings={state.settings}
            onStart={startActivity}
            onStop={stopActivity}
            onSwitch={switchActivity}
            onFinishDay={finishDay}
            onReopenDay={() => updateDay(displayedDayKey, (day) => ({ ...day, closedAt: null }))}
            onEditEntry={(entry) => openEdit(entry, displayedDayKey)}
            onVacation={() => setVacationOpen(true)}
          />
        )}
        {view === "overview" && (
          <OverviewView
            state={state}
            now={now}
            selectedMonth={selectedMonth}
            onMonthChange={setSelectedMonth}
            onEditEntry={openEdit}
            onVacation={() => setVacationOpen(true)}
            onRemoveVacation={removeVacation}
            onAddEntry={() => setAddEntryOpen(true)}
          />
        )}
        {view === "export" && (
          <ExportView
            state={state}
            now={now}
            onImportPreview={setImportPreview}
            onBackupCreated={(timestamp) => {
              setState((current) => ({
                ...current,
                settings: {
                  ...current.settings,
                  lastBackupAt: timestamp,
                },
              }));
            }}
          />
        )}
      </main>
      <nav className="bottom-nav">
        {navigation.map(({ key, label, icon: Icon }) => (
          <button key={key} className={view === key ? "active" : ""} onClick={() => setView(key)}>
            <Icon size={25} weight={view === key ? "fill" : "regular"} />
            <span>{label}</span>
            {key === "export" && backup.needsBackup && <i className="nav-alert" aria-label="Backup fällig" />}
          </button>
        ))}
      </nav>

      {settingsOpen && (
        <SettingsModal
          settings={state.settings}
          onClose={() => setSettingsOpen(false)}
          onSave={(settings) => {
            setState((current) => ({
              ...current,
              settings: {
                ...current.settings,
                ...settings,
              },
            }));
            setSettingsOpen(false);
          }}
        />
      )}
      {editing && (
        <EditEntryModal
          entry={editing.entry}
          onSave={saveEntry}
          onDelete={(entry) => {
            setDeletePending({ entry, dayKey: editing.dayKey });
            setEditing(null);
          }}
          onClose={() => setEditing(null)}
        />
      )}
      {vacationOpen && <VacationModal onSave={saveVacation} onClose={() => setVacationOpen(false)} />}
      {addEntryOpen && <AddEntryModal onSave={addEntry} onClose={() => setAddEntryOpen(false)} />}
      {deletePending && <DeleteEntryModal entry={deletePending.entry} onConfirm={deleteEntry} onClose={() => setDeletePending(null)} />}
      {importPreview && (
        <ImportPreviewModal
          preview={importPreview}
          onClose={() => setImportPreview(null)}
          onConfirm={() => {
            setState(importPreview.state);
            setImportPreview(null);
            setView("today");
            setSelectedMonth(localDateKey().slice(0, 7));
          }}
        />
      )}
    </div>
  );
}
