// Barrel re-export so consumers can `import { profileService } from "@/lib/services"`
// without committing to a specific file layout. Each service is exposed as a
// namespace so callers reference exports as e.g. `profileService.saveProfile`.

export * as accountService from "./account-service";
export * as imageService from "./image-service";
export * as postingService from "./posting-service";
export * as postService from "./post-service";
export * as profileService from "./profile-service";
export * as scheduleService from "./schedule-service";
export * as subscriptionService from "./subscription-service";
