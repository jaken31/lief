// Shape of an entry in lessons.json. The `id` values are the shared vocabulary
// between all three surfaces — they must stay identical to the LessonId union in
// lib/lessons.ts (Track A owns that file; this module never redefines it).
export type Lesson = {
  id: string;
  number: number;
  title: string;
  subtitle: string;
  minutes: number;
  detector: string;
  body: string[];
  spotIt: string[];
};
