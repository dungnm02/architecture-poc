// readonly: shown by the consumer, never edited from here. The cheapest shape.
function useController(ctx) {
  const { baseline, refetch, isLoading, error } = ctx
  return { data: baseline ?? [], refetch, isLoading, error }
}

export const attachment = {
  type: 'ATTACHMENT',
  relationType: 'hasAttachment',
  useController,
}

export default attachment
