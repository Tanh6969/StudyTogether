import { lazy } from 'react';

let studyRoomModulePromise: Promise<typeof import('./StudyRoom')> | undefined;

function importStudyRoom() {
  if (!studyRoomModulePromise) {
    studyRoomModulePromise = import('./StudyRoom').catch((error: unknown) => {
      studyRoomModulePromise = undefined;
      throw error;
    });
  }
  return studyRoomModulePromise;
}

export function preloadStudyRoomPage(): void {
  void importStudyRoom().catch((error: unknown) => {
    console.warn('Could not preload the study room page; it will load when opened.', error);
  });
}

export const LazyStudyRoom = lazy(() =>
  importStudyRoom().then(({ StudyRoom }) => ({ default: StudyRoom }))
);
