export const MONTH_SHORT_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function currentBillingPeriod(date = new Date()) {
  return `${MONTH_SHORT_NAMES[date.getMonth()]} ${date.getFullYear()}`;
}

export const BILLING_PERIOD = `Month of ${currentBillingPeriod()}`;

// Dates are handled as plain "YYYY-MM-DD" strings throughout (no time/zone
// component). Parsing "YYYY-MM-DD" via `new Date(str)` treats it as UTC
// midnight, which can shift the displayed calendar day by one in timezones
// behind UTC — so we parse the components manually and build a local Date.
export function formatDueDate(isoDate) {
  if (!isoDate) return "—";
  const [year, month, day] = String(isoDate).slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return "—";
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
}

// Bill payment dates come in two shapes: a plain "YYYY-MM-DD" (seeded data)
// or SQLite's UTC "YYYY-MM-DD HH:MM:SS" (payments recorded by the app).
export function formatPaymentDate(value) {
  if (!value) return "—";
  const str = String(value);
  if (str.length === 10) return formatDueDate(str);
  const d = new Date(str.replace(" ", "T") + "Z");
  return isNaN(d) ? str : d.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
}

export function dueDateForPeriod(period = currentBillingPeriod()) {
  const [month, year] = period.split(" ");
  const monthIndex = MONTH_SHORT_NAMES.indexOf(month);
  let dueMonth = monthIndex + 1;
  let dueYear = Number(year);
  if (dueMonth > 11) {
    dueMonth = 0;
    dueYear += 1;
  }
  return `${dueYear}-${String(dueMonth + 1).padStart(2, "0")}-09`;
}

export function billingDateForPeriod(period = currentBillingPeriod()) {
  const [month, year] = period.split(" ");
  const monthIndex = MONTH_SHORT_NAMES.indexOf(month);
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}-25`;
}

// How many whole days a bill is past its due date. Returns 0 for paid bills,
// missing due dates, or bills not yet due. Dates are compared at local midnight
// so a bill due "today" is not counted as overdue.
export function daysOverdue(dueDate, paymentStatus) {
  if (paymentStatus === "Paid" || !dueDate) return 0;
  const [y, m, d] = String(dueDate).slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return 0;
  const due = new Date(y, m - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.floor((today - due) / 86400000);
  return diff > 0 ? diff : 0;
}

// A household's current bill is overdue when it isn't paid and its due date has
// passed. (Display-only — no penalties are applied.)
export function isOverdue(household) {
  return household ? daysOverdue(household.dueDate, household.paymentStatus) > 0 : false;
}

export function peso(n) {
  return "₱" + n.toLocaleString("en-PH", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

// m³ used in one billing record, rounded so float subtraction noise
// (e.g. 24.4385 - 22 = 2.4385000000000012) never reaches the screen.
export function usedCm3(rec) {
  return Math.round((rec.curr - rec.prev) * 10000) / 10000;
}

export function getConsumptionStatus(me) {
  const pastUsages = me.history.slice(0, -1).map((r) => r.curr - r.prev);
  if (pastUsages.length === 0) {
    return {
      level: "normal",
      label: "Normal usage",
      message: `Your usage this cycle is ${me.consumption} m³. We'll start comparing this against your average once more billing history is available.`,
      tone: "good",
    };
  }
  const avg = pastUsages.reduce((s, v) => s + v, 0) / pastUsages.length;
  const ratio = me.consumption / avg;

  if (ratio >= 1.6) {
    return {
      level: "high",
      label: "High usage",
      message: `Your usage this cycle (${me.consumption} m³) is well above your average of ${avg.toFixed(0)} m³. This could indicate a leak — please check your pipes and faucets.`,
      tone: "bad",
    };
  }

  if (ratio >= 1.25) {
    return {
      level: "elevated",
      label: "Above normal",
      message: `Your usage this cycle (${me.consumption} m³) is higher than your usual average of ${avg.toFixed(0)} m³. Keep an eye on it over the next few days.`,
      tone: "warn",
    };
  }

  return {
    level: "normal",
    label: "Normal usage",
    message: `Your usage this cycle (${me.consumption} m³) is within your normal range (avg. ${avg.toFixed(0)} m³).`,
    tone: "good",
  };
}

// Display only: readings are stored to 4 decimals, shown to 2.
export const fmtCm3 = (n) => Number(n || 0).toFixed(2);
