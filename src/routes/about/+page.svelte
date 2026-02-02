<script lang="ts">
  // TODO: Fetch about data from Sanity
  // const query = `*[_type == "about"][0]`;
  let { data } = $props();
  import portrait from "$lib/assets/DSCF7533.jpg";
</script>

<svelte:head>
  <title>About | angel's rest</title>
</svelte:head>

<section>
  <div class="content">
    <div class="portrait-placeholder">
      {#if data.portraitUrl}
        <img src={data.portraitUrl} alt={data.about?.name} />
      {:else}
        <img src={portrait} alt="Portrait" />
      {/if}
    </div>
    <div class="bio">
      <h1>{data.about.name}</h1>
      <p>
        {data.about.shortBio}d
      </p>
      <p class="muted">
        {#if data.about?.social?.instagram}
          <a href={data.about.social.instagram} target="_blank" rel="noopener"
            >Instagram</a
          >
        {/if}
      </p>
    </div>
  </div>
</section>

<style>
  section {
    padding: 2rem 0;
  }

  .content {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4rem;
    align-items: start;
    max-width: 1000px;
  }

  .portrait-placeholder {
    aspect-ratio: 3 / 4;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
  }

  .bio {
    padding-top: 2rem;
  }

  h1 {
    margin-bottom: 1.5rem;
  }

  p {
    line-height: 1.8;
    margin-bottom: 1rem;
  }

  .muted {
    color: var(--color-text-muted);
  }

  @media (max-width: 768px) {
    .content {
      grid-template-columns: 1fr;
      gap: 2rem;
    }
  }
</style>
