import { lazy, Suspense } from 'react';

const Gallery = lazy(() => import('./UiGalleryPage'));

export function UiGallery() {
  return (
    <Suspense fallback={null}>
      <Gallery />
    </Suspense>
  );
}
