export function libraryChoices(data) {
  const groups = (data.libraries || []).map(l => ({ id: l.id, name: l.name,
    count: data.movies.filter(m => l.sourceIds.includes(m.sourceId)).length }));
  if (data.unassignedSourceIds?.length) groups.push({ id: '__unassigned', name: '未分配的来源', count: data.movies.filter(m => data.unassignedSourceIds.includes(m.sourceId)).length });
  return groups.length ? groups : data.isDemo ? [{ id: 'demo', name: '示例片库', count: data.movies.length }] : [];
}

export function resolveLibrary(data, requested) {
  const choices = libraryChoices(data);
  if (requested === 'all' && choices.length) return 'all';
  if (choices.some(s => s.id === requested)) return requested;
  return choices.length === 1 ? choices[0].id : null;
}

export function scopedMovies(data, selection) {
  if (!selection) return [];
  if (selection === 'all' || selection === 'demo' && data.isDemo) return data.movies;
  const sources = scopeSourceIds(data, selection);
  return data.movies.filter(m => sources.includes(m.sourceId));
}

export function scopeSourceIds(data, selection) {
  if (!selection) return [];
  if (selection === 'all') return (data.sources || []).map(s => s.id);
  if (selection === '__unassigned') return data.unassignedSourceIds || [];
  return data.libraries?.find(l => l.id === selection)?.sourceIds || [];
}
