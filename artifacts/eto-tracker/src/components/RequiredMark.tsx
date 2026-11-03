export function RequiredMark() {
  return (
    <>
      <span aria-hidden="true" className="text-red-600">*</span>
      <span className="sr-only"> required</span>
    </>
  );
}