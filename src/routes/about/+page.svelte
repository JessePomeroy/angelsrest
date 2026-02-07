<script lang="ts">
  import SEO from "$lib/components/SEO.svelte";
  import portrait from "$lib/assets/DSCF7533.jpg";
  
  let { data } = $props();
</script>

<SEO 
  title="about | angel's rest"
  description="About Jesse Pomeroy — photographer, visual artist, and florist based in Michigan. Get in touch for inquiries and collaborations."
  url="https://angelsrest.online/about"
/>

<section class="about">
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
        {data.about.shortBio}
      </p>
      <p class="muted">
        {#if data.about?.social?.instagram}
          <a href={data.about.social.instagram} target="_blank" rel="noopener">Instagram</a>
        {/if}
      </p>
    </div>
  </div>
</section>

<section class="contact">
  <h2>get in touch</h2>
  <p class="description">For inquiries, commissions, and collaborations.</p>

  <form
    onsubmit={(e) => {
      e.preventDefault();
    }}
  >
    <label>
      <span>Name</span>
      <input type="text" name="name" required />
    </label>
    <label>
      <span>Email</span>
      <input type="email" name="email" required />
    </label>
    <label>
      <span>Subject</span>
      <input type="text" name="subject" />
    </label>
    <label>
      <span>Message</span>
      <textarea name="message" rows="6" required></textarea>
    </label>
    <button type="submit">Send Message</button>
  </form>
</section>

<style>
  /* About section */
  .about {
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

  .portrait-placeholder img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .bio {
    padding-top: 2rem;
  }

  .bio h1 {
    margin-bottom: 1.5rem;
  }

  .bio p {
    line-height: 1.8;
    margin-bottom: 1rem;
  }

  .bio .muted {
    color: var(--color-text-muted);
  }

  /* Contact section */
  .contact {
    padding: 4rem 0 2rem;
    max-width: 600px;
    border-top: 1px solid var(--color-border);
    margin-top: 2rem;
  }

  .contact h2 {
    margin-bottom: 0.5rem;
  }

  .description {
    color: var(--color-text-muted);
    font-size: 0.9rem;
    margin-bottom: 3rem;
  }

  form {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  label {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  label span {
    font-size: 0.8rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--color-text-muted);
  }

  input,
  textarea {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    color: var(--color-text);
    padding: 0.75rem 1rem;
    font-family: var(--font-body);
    font-size: 0.95rem;
    transition: border-color var(--transition);
  }

  input:focus,
  textarea:focus {
    outline: none;
    border-color: var(--color-text-muted);
  }

  textarea {
    resize: vertical;
  }

  button {
    padding: 1rem;
    font-size: 0.8rem;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    border: 1px solid var(--color-text);
    background: var(--color-text);
    color: var(--color-bg);
    transition: all var(--transition);
    margin-top: 0.5rem;
  }

  button:hover {
    opacity: 0.85;
  }

  @media (max-width: 768px) {
    .content {
      grid-template-columns: 1fr;
      gap: 2rem;
    }

    .contact {
      padding-top: 3rem;
    }
  }
</style>
