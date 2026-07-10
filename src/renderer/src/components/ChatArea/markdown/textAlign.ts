// Tailwind JIT cannot statically detect class names that are built by
// string interpolation (`text-${align}`). When callers pass
// `style={{ textAlign: 'center' }}`, the resulting class would never be
// generated. An explicit map ensures the four alignment utilities are
// emitted by the build and shared by every consumer.
export const TEXT_ALIGN_CLASS: Record<string, string> = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
  justify: 'text-justify',
};

export function textAlignClass(align: string | undefined): string {
  return TEXT_ALIGN_CLASS[align ?? ''] ?? TEXT_ALIGN_CLASS.left;
}