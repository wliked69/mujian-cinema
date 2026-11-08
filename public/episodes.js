export function isTelevision(movie) {
  return movie?.mediaType === 'tv' || Number(movie?.episodeCount) > 0 || !!movie?.episodes?.length;
}
export function selectedEpisode(movie, preferred) {
  return movie.episodes?.find(e => e.id === preferred) || movie.episodes?.[0] || null;
}
