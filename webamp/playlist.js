import { trackUrlForSongId } from "./musicKitMedia.js";

async function fetchPlaylist(music, playlistId) {
  const path = playlistId.startsWith("p.")
    ? `/v1/me/library/playlists/${playlistId}`
    : `/v1/catalog/${music.storefrontId ?? "us"}/playlists/${playlistId}`;

  const { data } = await music.api.music(path, { include: "tracks" });
  const playlist = data.data?.[0];
  if (playlist == null) {
    throw new Error(`No such playlist: ${playlistId}`);
  }

  const tracks = playlist.relationships?.tracks;
  const songs = [...(tracks?.data ?? [])];
  let next = tracks?.next ?? null;
  while (next != null) {
    const page = await music.api.music(next);
    songs.push(...page.data.data);
    next = page.data.next ?? null;
  }

  return { name: playlist.attributes?.name ?? playlistId, songs };
}

export async function getPlaylist(music, playlistId) {
  const { name, songs } = await fetchPlaylist(music, playlistId);
  const tracks = songs
    .filter((song) => song.attributes?.playParams != null)
    .map(({ id, attributes }) => ({
      url: trackUrlForSongId(attributes.playParams.catalogId ?? id),
      duration: (attributes.durationInMillis ?? 0) / 1000,
      metaData: {
        artist: attributes.artistName ?? "",
        title: attributes.name ?? "",
        album: attributes.albumName,
        albumArtUrl:
          attributes.artwork == null
            ? undefined
            : MusicKit.formatArtworkURL(attributes.artwork, 100, 100),
      },
    }));
  return { name, tracks };
}
