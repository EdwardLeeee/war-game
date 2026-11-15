// 新手教學 (R25): what the battlefield asks the tutorial (tutorial/tutor.ts), set on Game while it runs.

export interface TutorHooks {
  /** A tap (or long press) at this screen point does something: inside the frame, or the step lets any through. */
  tapAllowed(sx: number, sy: number): boolean;
  /** A tap the frame kept off: the frame flashes (ceo 2026-11-15: no words). */
  blocked(): void;
  /** The camera dragged by a finger, pinched (step 1). */
  panned(): void;
  pinched(): void;
  /** A tap on the minimap is let through, and one was made (step 1). */
  minimapAllowed(): boolean;
  minimapTapped(): void;
  /** A snapshot came: whether the step is done. */
  snapshot(): void;
}
