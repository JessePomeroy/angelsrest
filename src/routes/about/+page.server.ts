import { client, urlFor } from '$lib/sanity/client';

export const load = async () => {
  const about = await client.fetch(
    `*[_type == "about"][0]{
      name,
      portrait,
      bio,
      shortBio,
      email,
      social
    }`
  );

  return {
    about,
    portraitUrl: about?.portrait
      ? urlFor(about.portrait).width(800).url()
      : null
  };
};
