import {
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { CSS, type Transform } from "@dnd-kit/utilities";

/** Pointer + keyboard sensors shared by the vertical sortable lists. */
export function useListDragSensors() {
  return useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
}

/**
 * Style for a dragged row. Translate only — CSS.Transform would also apply
 * dnd-kit's scaleX/scaleY, stretching the row to fit differently-sized
 * neighbours.
 */
export const sortableRowStyle = (
  transform: Transform | null,
  transition: string | undefined,
) => ({
  transform: CSS.Translate.toString(transform),
  transition,
});

/** Resolve a drag-end event to `[fromIndex, toIndex]` within `ids`, or null. */
export function resolveDragMove(
  event: DragEndEvent,
  ids: string[],
): [number, number] | null {
  const { active, over } = event;
  if (!over || active.id === over.id) return null;
  const from = ids.indexOf(String(active.id));
  const to = ids.indexOf(String(over.id));
  if (from < 0 || to < 0) return null;
  return [from, to];
}
