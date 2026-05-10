# HTML Deck

HTML Deck is a PowerPoint-style presentation player where every slide is a standalone HTML file.

## Use

- Open `index.html` to choose and manage presentations in gallery mode.
- Open a presentation from the gallery, then choose `Present`.
- Use the right and left arrow keys to move between slides.
- Press `b` for a black screen.
- Press `w` for a white screen.
- Press `space` to show or hide speaker notes.
- Press `g` or `Escape` while presenting to return to the gallery.

## Slides

Each presentation lives in its own folder under `presentations/`. The available presentations are listed in `presentations/index.json`.

Slides live in a presentation's `slides/` folder and are sequenced by that presentation's `deck.json`.

Speaker notes live inside each slide as JSON:

```html
<script type="application/json" data-speaker-notes>
{
  "notes": "Speaker notes go here."
}
</script>
```

## Netlify GitHub Saving

The gallery can save changes back to GitHub through a Netlify Function. Add these environment variables in Netlify with Functions access:

- `GITHUB_TOKEN`: a fine-grained token with Contents write access to this repository
- `GITHUB_OWNER`: the GitHub account or organization
- `GITHUB_REPO`: `htmldeck`
- `GITHUB_BRANCH`: usually `main`
- `EDITOR_TOKEN`: a private passcode required by the gallery before it can save
- `OPENAI_API_KEY`: required for the slide agent in presentation mode
- `OPENAI_MODEL`: optional, defaults to `gpt-5.2`

Without those variables, the gallery still works and can download edited `deck.json` or slide HTML files.

## Slide Agent

In presentation mode, press `a` to open the slide agent sidebar. The agent can edit the current slide HTML, save the previous HTML as a timestamped version, and restore an earlier version from the sidebar.
