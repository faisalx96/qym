import { useRunPage } from '../RunContext';

export function ItemsSection(_props: { panelOpen: boolean; onOpenPanel: () => void; wide: boolean }) {
  const { items } = useRunPage();
  return <section id="run-items">{items.length} items</section>;
}
