# HTML Deck

HTML Deck is a PowerPoint-style presentation player where every slide is a standalone HTML file.

## Use

- Open `index.html` to present.
- Use the right and left arrow keys to move between slides.
- Press `b` for a black screen.
- Press `w` for a white screen.
- Press `space` to show or hide speaker notes.
- Open `gallery.html` to resequence slides and edit slide titles, speaker notes, and HTML.

## Slides

Slides live in `slides/` and are sequenced by `deck.json`.

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

Without those variables, the gallery still works and can download edited `deck.json` or slide HTML files.
