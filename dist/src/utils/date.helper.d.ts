declare class DateServiceBase {
    getStartOfTheDay(date: string | Date): Date;
    getStartOfTheDay_iso(date: string | Date): string;
    getEndOfTheDay(date: string | Date): Date;
    getEndOfTheDay_iso(date: string | Date): string;
    private padStart;
    getTimeStampVariables(date: string | Date): {
        milliseconds: string;
        seconds: string;
        minutes: string;
        hours: string;
        day: string;
        month: string;
        year: string;
    };
    isValidFormat_YYYY_MM_DD(dateString: string): boolean;
    getDateFormat_YYYY_MM_DD(date?: string | Date): string;
    getDateNormalFormat(date: string | Date): string;
    getDayFromDate(dateString: string): number;
    addYears(date: string | Date, years: number): Date;
    addMonths(date: string | Date, months: number): Date;
    addDays(date: string | Date, days: number): Date;
    getCurrentTime(): string;
}
export declare const DateService: DateServiceBase;
export {};
