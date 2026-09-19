import { useEffect, useState } from 'react';
import lessonsData from './lessons.json';
import type { Lesson } from './types';

const LESSONS: Lesson[] = lessonsData.lessons;

/**
 * The banner deep-links to `pages/course/index.html#<lessonId>`. Any query
 * string appended to the hash is discarded, so a link carrying tracking params
 * still lands on the lesson instead of quietly falling back to the index.
 */
function useLessonId(): string {
  const read = () =>
    decodeURIComponent(window.location.hash.replace(/^#/, '').split(/[?&]/)[0]).trim();
  const [lessonId, setLessonId] = useState(read);

  useEffect(() => {
    const onHashChange = () => setLessonId(read());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  return lessonId;
}

function LessonIndex() {
  return (
    <main className="page">
      <header className="page-head">
        <p className="eyebrow">Lief course</p>
        <h1>Five things worth recognising</h1>
        <p className="lede">
          Each lesson is about three minutes and pairs with a detector in the extension. When Lief
          warns you about a real page, it names the lesson that explains it.
        </p>
      </header>

      <ol className="lesson-list">
        {LESSONS.map((lesson) => (
          <li key={lesson.id}>
            <a className="lesson-card" href={`#${lesson.id}`}>
              <span className="lesson-number">{lesson.number}</span>
              <span className="lesson-card-text">
                <span className="lesson-card-title">{lesson.title}</span>
                <span className="lesson-card-subtitle">{lesson.subtitle}</span>
              </span>
              <span className="lesson-minutes">{lesson.minutes} min</span>
            </a>
          </li>
        ))}
      </ol>
    </main>
  );
}

function LessonView({ lesson }: { lesson: Lesson }) {
  const next = LESSONS.find((candidate) => candidate.number === lesson.number + 1);

  return (
    <main className="page">
      <a className="back" href="#">
        All lessons
      </a>

      <header className="page-head">
        <p className="eyebrow">
          Lesson {lesson.number} · {lesson.minutes} min
        </p>
        <h1>{lesson.title}</h1>
        <p className="lede">{lesson.subtitle}</p>
      </header>

      <article className="prose">
        {lesson.body.map((paragraph, index) => (
          <p key={index}>{paragraph}</p>
        ))}
      </article>

      <section className="spot-it">
        <h2>Spot it</h2>
        <ul>
          {lesson.spotIt.map((example, index) => (
            <li key={index}>{example}</li>
          ))}
        </ul>
      </section>

      <p className="detector">
        <strong>Lief catches this with:</strong> {lesson.detector}
      </p>

      {next ? (
        <a className="next" href={`#${next.id}`}>
          Next — {next.title} →
        </a>
      ) : null}
    </main>
  );
}

export default function Course() {
  const lessonId = useLessonId();
  const lesson = LESSONS.find((candidate) => candidate.id === lessonId);

  // Unknown or absent hash falls back to the index rather than an error state —
  // a dead end here would break the banner's "Show me why" path.
  return lesson ? <LessonView lesson={lesson} /> : <LessonIndex />;
}
