/**
 * Egypt Cairo Timezone Helper Functions
 */

// Parses a date-time string as an absolute Date object, assuming the input was entered in Egypt (Africa/Cairo) local time
export const parseEventDateInEgypt = (dateStr: string): Date => {
  if (!dateStr) return new Date();

  // If the date string has a timezone offset already (ends with Z or +/- offset), parse it natively
  if (dateStr.includes('Z') || /[-+]\d{2}:\d{2}$/.test(dateStr)) {
    return new Date(dateStr);
  }

  let year = 2026, month = 0, day = 1, hours = 0, minutes = 0, seconds = 0;

  const hasT = dateStr.includes('T');
  const datePart = hasT ? dateStr.split('T')[0] : dateStr;
  const timePart = hasT ? dateStr.split('T')[1] : '';

  const dateParts = datePart.split('-');
  if (dateParts.length === 3) {
    year = parseInt(dateParts[0], 10);
    month = parseInt(dateParts[1], 10) - 1; // 0-indexed
    day = parseInt(dateParts[2], 10);
  } else {
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? new Date() : d;
  }

  if (timePart) {
    const timeParts = timePart.split(':');
    if (timeParts.length >= 2) {
      hours = parseInt(timeParts[0], 10);
      minutes = parseInt(timeParts[1], 10);
      if (timeParts.length >= 3) {
        seconds = parseInt(timeParts[2], 10);
      }
    }
  }

  try {
    // Construct a UTC date roughly around that time to query the timezone formatter
    const testDate = new Date(Date.UTC(year, month, day, hours, minutes, seconds));
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Africa/Cairo',
      year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric',
      hour12: false
    });

    const parts = formatter.formatToParts(testDate);
    const getPart = (type: string) => parseInt(parts.find(p => p.type === type)?.value || '0', 10);

    const fYear = getPart('year');
    const fMonth = getPart('month') - 1;
    const fDay = getPart('day');
    const fHour = getPart('hour') === 24 ? 0 : getPart('hour'); // handle 24:00 formatting
    const fMin = getPart('minute');
    const fSec = getPart('second');

    const formattedDateUTC = Date.UTC(fYear, fMonth, fDay, fHour, fMin, fSec);
    const offsetMs = testDate.getTime() - formattedDateUTC;

    const targetUTC = Date.UTC(year, month, day, hours, minutes, seconds);
    return new Date(targetUTC + offsetMs);
  } catch (e) {
    console.warn("Intl timezone parsing failed, falling back to local offset:", e);
    return new Date(year, month, day, hours, minutes, seconds);
  }
};

// Formats any date into a beautiful, human-readable string in Egypt (Africa/Cairo) timezone
export const formatMilestoneDateInEgypt = (dateStr: string): string => {
  if (!dateStr) return '';
  const d = parseEventDateInEgypt(dateStr);

  const hasTime = dateStr.includes('T') || dateStr.includes(':');
  if (hasTime) {
    return d.toLocaleString('en-US', {
      timeZone: 'Africa/Cairo',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
  }

  return d.toLocaleDateString('en-US', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
};

// Formats the current time in Egypt timezone for the live dashboard clock
export const getEgyptTimeString = (): { date: string; time: string; period: string } => {
  const now = new Date();
  try {
    const timeOptions: Intl.DateTimeFormatOptions = {
      timeZone: 'Africa/Cairo',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    };
    const dateOptions: Intl.DateTimeFormatOptions = {
      timeZone: 'Africa/Cairo',
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    };

    const timeStr = new Intl.DateTimeFormat('en-US', timeOptions).format(now); // e.g. "02:30:15 PM"
    const dateStr = new Intl.DateTimeFormat('en-US', dateOptions).format(now);

    const parts = timeStr.split(' ');
    const time = parts[0];
    const period = parts[1] || '';

    return {
      date: dateStr,
      time: time,
      period: period
    };
  } catch {
    return {
      date: now.toLocaleDateString(),
      time: now.toLocaleTimeString(),
      period: ''
    };
  }
};

// Gets the Year, Month (0-11), and Day components of any Date in Egypt timezone
export const getEgyptCalendarComponents = (date: Date): { year: number; month: number; day: number } => {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Africa/Cairo',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric'
    });
    const parts = formatter.formatToParts(date);
    const getPart = (type: string) => parseInt(parts.find(p => p.type === type)?.value || '0', 10);
    return {
      year: getPart('year'),
      month: getPart('month') - 1, // 0-indexed
      day: getPart('day')
    };
  } catch (e) {
    // Fallback to local browser timezone components
    return {
      year: date.getFullYear(),
      month: date.getMonth(),
      day: date.getDate()
    };
  }
};

// Calculates exact calendar days between a stored event date string and the current date, rolling over exactly at midnight local Egypt time
export const getDaysTogetherInEgypt = (anniversaryDateStr: string): number => {
  if (!anniversaryDateStr) return 0;
  
  // 1. Parse the anniversary string into its Egypt timezone calendar components
  const annDate = parseEventDateInEgypt(anniversaryDateStr);
  const annComp = getEgyptCalendarComponents(annDate);
  
  // 2. Get current Egypt timezone calendar components
  const nowComp = getEgyptCalendarComponents(new Date());
  
  // 3. Create UTC dates with these exact components to do standard day subtraction without any DST/timezone shifts
  const annUtc = Date.UTC(annComp.year, annComp.month, annComp.day);
  const nowUtc = Date.UTC(nowComp.year, nowComp.month, nowComp.day);
  
  const diffMs = nowUtc - annUtc;
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return Math.max(0, days);
};

// Calculates calendar days until a milestone, rolling over exactly at midnight local Egypt time
export const getDaysUntilMilestoneInEgypt = (dateStr: string): number => {
  if (!dateStr) return 999;
  
  // Stored date components in Egypt timezone
  const storedDate = parseEventDateInEgypt(dateStr);
  if (isNaN(storedDate.getTime())) return 999;
  const storedComp = getEgyptCalendarComponents(storedDate);
  
  // Current date components in Egypt timezone
  const nowComp = getEgyptCalendarComponents(new Date());
  
  // Construct UTC dates to compare
  const todayUtc = Date.UTC(nowComp.year, nowComp.month, nowComp.day);
  const storedUtc = Date.UTC(storedComp.year, storedComp.month, storedComp.day);
  
  // 1. If storedDate is in the future, check days until then
  if (storedUtc >= todayUtc) {
    const diffTime = storedUtc - todayUtc;
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  }
  
  // 2. If storedDate is in the past, it's likely an annual recurring milestone (like a birthday or anniversary).
  // Check the occurrence for the current year
  const currentYearOccurrenceUtc = Date.UTC(nowComp.year, storedComp.month, storedComp.day);
  
  if (currentYearOccurrenceUtc >= todayUtc) {
    const diffTime = currentYearOccurrenceUtc - todayUtc;
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  } else {
    // If it already passed this year, check next year
    const nextYearOccurrenceUtc = Date.UTC(nowComp.year + 1, storedComp.month, storedComp.day);
    const diffTime = nextYearOccurrenceUtc - todayUtc;
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  }
};

// Calculates real-world hours left until a planned date in Egypt timezone
export const getHoursUntilDatePlanInEgypt = (dateTimeStr: string): number => {
  if (!dateTimeStr) return -1;
  const planDate = parseEventDateInEgypt(dateTimeStr);
  if (isNaN(planDate.getTime())) return -1;
  const now = new Date();
  const diffMs = planDate.getTime() - now.getTime();
  return diffMs / (1000 * 60 * 60);
};

/**
 * Calculates end date based on start date and duration in days.
 * If durationDays is -1 or <= 0, returns undefined (lifetime/unlimited).
 */
export const calculateSubscriptionEndDate = (startDate: Date = new Date(), durationDays: number = 30): string | undefined => {
  if (durationDays === -1 || durationDays <= 0) return undefined;
  const endDate = new Date(startDate.getTime());
  endDate.setDate(endDate.getDate() + durationDays);
  return endDate.toISOString();
};
