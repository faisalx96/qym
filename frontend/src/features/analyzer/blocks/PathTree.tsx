import { Checkbox } from '@/ui';
import { formatPathLabel, nodeLeaves, nodeState, type PathNode } from '../model/mapping';
import s from './fields.module.css';

/** Tri-state JSON path tree. `selected` holds leaf paths; toggling a group toggles every leaf under it. */
export function PathTree({
  nodes,
  selected,
  onToggle,
  disabled,
}: {
  nodes: PathNode[];
  selected: ReadonlySet<string>;
  onToggle: (node: PathNode) => void;
  disabled?: boolean;
}) {
  return (
    <ul className={s.tree}>
      {nodes.map((node) => {
        const state = nodeState(node, selected);
        const leaves = nodeLeaves(node);
        return (
          <li key={node.path + node.label} className={s.treeNode}>
            <Checkbox
              isSelected={state === 'all'}
              isIndeterminate={state === 'some'}
              isDisabled={disabled}
              onChange={() => onToggle(node)}
            >
              <span className={s.mono}>{formatPathLabel(node.label)}</span>
              {node.children.length ? <span className={s.nodeKind}>{`group · ${leaves.length}`}</span> : null}
            </Checkbox>
            {node.children.length ? (
              <PathTree nodes={node.children} selected={selected} onToggle={onToggle} disabled={disabled} />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
