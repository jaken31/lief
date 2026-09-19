import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import Course from './Course';
import './course.css';

const container = document.getElementById('root');

if (container) {
  createRoot(container).render(
    <StrictMode>
      <Course />
    </StrictMode>,
  );
}
