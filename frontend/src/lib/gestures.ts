import type { NormalizedLandmark } from "@mediapipe/tasks-vision";

export type Gesture = "none" | "fist" | "palm" | "point" | "victory";

export const GESTURES: Record<Exclude<Gesture, "none">, { name: string; action: string; toast: string }> = {
  fist: { name: "Closed fist", action: "Freezes the frame and scans it.", toast: "Frozen. Scanning…" },
  palm: { name: "Open palm", action: "Back to the live picture; clears old results.", toast: "Live again" },
  point: { name: "Point", action: "A magnifier follows your fingertip.", toast: "" },
  victory: { name: "Two fingers", action: "Switches the view: edges, contrast, false colour.", toast: "" },
};

const d = (a: NormalizedLandmark, b: NormalizedLandmark) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Classify a single hand from MediaPipe's 21 landmarks.
 * A finger counts as extended when its tip is well beyond its knuckle
 * (measured from the wrist), and curled when the tip folds back near it.
 */
export function classify(lm: NormalizedLandmark[]): Gesture {
  if (lm.length < 21) return "none";
  const wrist = lm[0];
  const state = (mcp: number, tip: number): "ext" | "curl" | "mid" => {
    const r = d(lm[tip], wrist) / Math.max(d(lm[mcp], wrist), 1e-6);
    return r > 1.55 ? "ext" : r < 1.25 ? "curl" : "mid";
  };
  const index = state(5, 8);
  const middle = state(9, 12);
  const ring = state(13, 16);
  const pinky = state(17, 20);
  const fingers = [index, middle, ring, pinky];
  const ext = fingers.filter((f) => f === "ext").length;
  const curl = fingers.filter((f) => f === "curl").length;

  if (ext === 4) return "palm";
  if (curl === 4) return "fist";
  if (index === "ext" && middle === "ext" && ring === "curl" && pinky === "curl") return "victory";
  if (index === "ext" && middle === "curl" && ring === "curl" && pinky === "curl") return "point";
  return "none";
}

/** Debounces per-frame gesture labels into held gestures with a progress value. */
export class GestureTracker {
  private current: Gesture = "none";
  private since = 0;
  private fired = false;
  private misses = 0;

  constructor(private holdMs = 650) {}

  update(g: Gesture, now: number): { gesture: Gesture; progress: number; fire: Gesture | null } {
    // Tolerate a couple of dropped frames so a held gesture does not restart.
    if (g !== this.current) {
      if (this.current !== "none" && this.misses < 3) {
        this.misses++;
        g = this.current;
      } else {
        this.current = g;
        this.since = now;
        this.fired = false;
        this.misses = 0;
      }
    } else {
      this.misses = 0;
    }
    const progress = this.current === "none" ? 0 : Math.min((now - this.since) / this.holdMs, 1);
    let fire: Gesture | null = null;
    if (progress >= 1 && !this.fired && this.current !== "none" && this.current !== "point") {
      this.fired = true;
      fire = this.current;
    }
    return { gesture: this.current, progress, fire };
  }
}

export const HAND_CONNECTIONS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];
