class DateServiceBase {
  getStartOfTheDay(date: string | Date) {
    const parsedDate = new Date(date);
    if (isNaN(parsedDate.getTime())) {
      throw new Error(`Invalid date provided: ${date}`);
    }
    const d = new Date(this.getStartOfTheDay_iso(date));
    return d;
  }

  getStartOfTheDay_iso(date: string | Date) {
    if (
      date &&
      typeof date === 'string' &&
      this.isValidFormat_YYYY_MM_DD(date)
    ) {
      return `${date}T00:00:00.000Z`;
    }
    const dt = new Date(date);
    const datePart = this.getDateFormat_YYYY_MM_DD(dt);
    const d = `${datePart}T00:00:00.000Z`;
    return d;
  }

  getEndOfTheDay(date: string | Date) {
    const d = new Date(this.getEndOfTheDay_iso(date));
    // Check if the parsedDate is valid
    if (isNaN(d.getTime())) {
      throw new Error(`Invalid date provided: ${date}`);
    }
    return d;
  }

  getEndOfTheDay_iso(date: string | Date) {
    if (
      date &&
      typeof date === 'string' &&
      this.isValidFormat_YYYY_MM_DD(date)
    ) {
      return `${date}T23:59:59.000Z`;
    }
    const dt = new Date(date);
    const datePart = this.getDateFormat_YYYY_MM_DD(dt);
    const d = `${datePart}T23:59:59.000Z`;
    return d;
  }

  private padStart(
    value: string | number,
    maxLength: number,
    fillingValue: string | number,
  ) {
    const _val = `${value}`.padStart(maxLength, `${fillingValue}`.toString());
    return _val.toString().trim();
  }

  /** {year,month,day,hours,minutes,seconds,milliseconds} padded */
  getTimeStampVariables(date: string | Date) {
    const _now = date ? new Date(date) : new Date();
    return {
      milliseconds: this.padStart(_now.getMilliseconds(), 4, 0),
      seconds: this.padStart(_now.getSeconds(), 2, 0),
      minutes: this.padStart(_now.getMinutes(), 2, 0),
      hours: this.padStart(_now.getHours(), 2, 0),
      day: this.padStart(_now.getDate(), 2, 0),
      month: this.padStart(_now.getMonth() + 1, 2, 0),
      year: `${_now.getFullYear()}`,
    };
  }

  isValidFormat_YYYY_MM_DD(dateString: string) {
    if (!(dateString && typeof dateString === 'string')) {
      return false;
    }
    const regEx = /^\d{4}-\d{2}-\d{2}$/;

    if (!regEx.test(dateString)) {
      // Invalid format
      return false;
    }

    const pdate = dateString.split('-');
    if (pdate?.length !== 3) {
      return false;
    }
    const [yyyy, mm, dd] = pdate.map((dt) => parseInt(dt));

    if (!(mm >= 1 && mm <= 12)) {
      return false;
    }
    // Create list of days of a month [assume there is no leap year by default]
    const listOfDays = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

    const isNonLeapYearMonth = mm === 1 || mm > 2;

    if (isNonLeapYearMonth) {
      if (dd > listOfDays[mm - 1]) {
        return false;
      }
    } else {
      let lyear = false;
      if ((!(yyyy % 4) && yyyy % 100) || !(yyyy % 400)) {
        lyear = true;
      }
      if (lyear === false && dd >= 29) {
        return false;
      }
      if (lyear === true && dd > 29) {
        return false;
      }
    }
    const d = new Date(dateString);
    const dNum = d.getTime();
    if (!dNum && dNum !== 0) {
      // NaN value, Invalid date
      return false;
    }
    const check1 = d.toISOString().slice(0, 10) === dateString;
    const check2 = d.toISOString().split('T')[0] === dateString;
    return check1 && check2;
  }

  /** yyyy-mm-dd */
  getDateFormat_YYYY_MM_DD(date?: string | Date) {
    const _dt = date ? new Date(date) : new Date();
    const dt = this.getTimeStampVariables(_dt);
    return [dt.year, '-', dt.month, '-', dt.day].join('');
  }

  /** Output: April 3, 2024 */
  getDateNormalFormat(date: string | Date) {
    const now = new Date(date);
    const options: Intl.DateTimeFormatOptions = {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    };
    return now.toLocaleDateString('en-US', options);
  }

  getDayFromDate(dateString: string) {
    const date = new Date(dateString);
    const day = date.getDate();
    return day;
  }

  addYears(date: string | Date, years: number) {
    const _dt = new Date(date);
    _dt.setFullYear(_dt.getFullYear() + years);
    return _dt;
  }

  addMonths(date: string | Date, months: number) {
    const _dt = new Date(date);
    _dt.setMonth(_dt.getMonth() + months);
    return _dt;
  }

  addDays(date: string | Date, days: number) {
    const _dt = isNaN(new Date(date).getTime()) ? new Date() : new Date(date);
    _dt.setDate(_dt.getDate() + days);
    const newDate = new Date(_dt);
    return newDate;
  }

  getCurrentTime() {
    return new Date().toLocaleTimeString();
  }
}
export const DateService = new DateServiceBase();
