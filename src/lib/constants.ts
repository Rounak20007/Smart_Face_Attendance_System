// Centralized constants for the FaceMark attendance system
// All magic numbers should be defined here with explanatory comments

// Attendance and cooldown settings
export const COOLDOWN_MS = 30_000; // 30 second cooldown per person per camera
// Prevents duplicate attendance markings within short time periods

export const ERROR_THRESHOLD = 5; // Maximum consecutive errors before pausing processing
// After this many errors, processing pauses to avoid spamming failed attempts

export const RECOVERY_TIME_MS = 2000; // Time to pause processing after error threshold reached (ms)
// Cool-down period after too many consecutive errors

// Face tracking and detection parameters
export const TRACK_IOU_THRESHOLD = 0.3; 
// Minimum Intersection-over-Union for matching detections to existing tracks
// Higher = stricter matching, Lower = more lenient matching

export const MAX_TRACK_AGE_MS = 2000; // 2 second track timeout
// How long a track persists without matching detections before being removed

export const DETECTION_INTERVAL_MS = 500; // throttle AI detection to avoid running on every animation frame
// Base interval between face detection runs (can be adapted based on system load)

// Face recognition threshold
export const FACE_RECOGNITION_THRESHOLD = 0.5; 
// Maximum distance for a face descriptor match (lower = stricter)
// Typical values: 0.4-0.6 for face-api.js with 128-dimensional descriptors

// UI/UX constants
export const MAX_RECENT_DISPLAY = 8; 
// Maximum number of recent attendance records to display in UI
