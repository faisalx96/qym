import { useCompare } from '../../CompareContext';

export function ItemsSection() {
  const { items } = useCompare();
  return <p>{items.length} items</p>;
}
