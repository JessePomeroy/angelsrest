# Angel's Rest

A personal portfolio and creative studio website for Jesse Pomeroy — photographer, visual artist, florist, and web developer.

**Live:** [angelsrest.online](https://angelsrest.online) ✨

## What It Is

Angel's Rest showcases Jesse's multidisciplinary creative work through a thoughtfully designed digital experience. The site combines photography portfolio, art gallery, blog, and e-commerce in one cohesive platform.

## ✨ Special Features

### 🕐 Time-Aware Theming
The site subtly shifts its color palette based on your local time of day:
- **Dawn** (5-8am): Soft pink and coral warmth
- **Morning** (8am-12pm): Bright, clear yellows  
- **Afternoon** (12-5pm): Warm amber baseline
- **Golden Hour** (5-8pm): Rich orange and honey tones
- **Evening** (8-10pm): Deep purple and violet
- **Night** (10pm-5am): Cool indigo and blue

The effect is subtle — like natural lighting shifting throughout the day.

### 🎨 ASCII Art Portrait
On the about page, hover over Jesse's portrait to watch it transform into animated ASCII art:
- Starts with scrambled random characters
- Gradually "settles" into the final portrait over 2 seconds
- Rendered to canvas for pixel-perfect alignment with the original image
- No layout shift or zoom — just pure magic

### 📱 Thoughtful UX
- **Mobile-first design** with bottom navigation that feels native
- **Instant theme switching** between light and dark modes
- **Smooth animations** and micro-interactions throughout
- **Typography-focused** with all-lowercase aesthetic

## Tech Highlights

**Frontend:** SvelteKit 5 (with runes), TypeScript, Tailwind CSS v4  
**Design:** Skeleton UI with Hamlindigo theme  
**Content:** Sanity CMS with real-time editing  
**Commerce:** Stripe checkout integration  
**Deployment:** Vercel with automatic deployments

## Content Areas

- **Gallery** — Photography portfolio with category filtering and lightbox modal
- **Shop** — Print sales with live Stripe checkout 
- **Blog** — Writing and project updates using Sanity's rich text editor
- **About** — Bio, contact form, and that ASCII portrait trick

## Creative Code

This project explores the intersection of art and web development:
- **Time as a design element** — the site feels alive and responsive to the natural rhythm of the day
- **Canvas manipulation** — generating and animating ASCII art in real-time  
- **Subtle interactions** — effects that enhance without overwhelming
- **Performance-conscious creativity** — all animations are GPU-accelerated and lightweight

## Local Development

```bash
# Clone and install
git clone [repo-url]
cd angelsrest
npm install

# Set up environment
cp .env.example .env
# Add your Sanity project ID, Stripe keys, etc.

# Run dev server
npm run dev

# Run Sanity Studio (separate terminal)
cd angelsrest-studio
npm run dev
```

## About Jesse

Multidisciplinary artist based in Michigan, working across photography, printmaking, floral design, and web development. Currently exploring how these creative practices intersect and inform each other.

**Contact:** Through the site's contact form or [Instagram](https://instagram.com/username)

---

*Built with curiosity and attention to detail. All code is educational — feel free to learn from it.*