<svelte:head>
	<title>Contact | angelsrest</title>
</svelte:head>

<section>
	<h1>Contact</h1>
	<p class="description">For inquiries, commissions, and collaborations.</p>

	<form onsubmit={(e) => { e.preventDefault(); }}>
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
	section {
		padding: 2rem 0;
		max-width: 600px;
	}

	h1 {
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
</style>
