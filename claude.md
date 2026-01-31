# BC Radio - Project Notes

## Holiday Mode (Christmas)

The site has a holiday mode that includes:
- Falling snowflakes animation
- Animated Christmas lights at the top of the page
- Fireplace video background (YouTube embed with blur effect)
- A "Christmas" tab with a holiday playlist (separate from live radio)
- Holiday edition title ("BC Radio: Holiday edition")

### Current Status: DISABLED

Holiday mode is currently disabled. All holiday elements are hidden using the `hidden` CSS class.

### Quick Preview (URL Parameter)

You can preview holiday mode any time by adding `?holidaymode=true` to the URL:
```
https://yoursite.com/?holidaymode=true
```

This temporarily enables all holiday features without modifying the code.

### To Enable Holiday Mode (Permanent)

Make the following changes in `index.html`:

#### 1. Enable Snowflakes (around line 1338)
Remove `hidden` class from the snowflakes `<div>`:
```html
<!-- Change this: -->
<div class="snowflakes hidden" aria-hidden="true">

<!-- To this: -->
<div class="snowflakes" aria-hidden="true">
```

#### 2. Enable Christmas Lights (around line 1395)
Remove `hidden` class from the christmas lights `<ul>`:
```html
<!-- Change this: -->
<ul class="christmas-lights lightrope hidden">

<!-- To this: -->
<ul class="christmas-lights lightrope">
```

#### 3. Switch Backgrounds (around line 1410)
Hide the static background and show the fireplace video:
```html
<!-- Hide the static background (add 'hidden'): -->
<div class="bg-static hidden"></div>

<!-- Show the fireplace video (remove 'hidden'): -->
<div class="bg-video" style="...">
```

#### 4. Enable Tab Toggle (around line 1487)
- Add `hidden` class to the non-holiday header bar (the simple one with just the Request button)
- Remove `hidden` class from the Mode Toggle div (the one with tab-upnext and tab-christmas buttons)

```html
<!-- Hide this (non-holiday header): -->
<div class="flex items-center justify-end ... hidden">

<!-- Show this (holiday tab toggle): -->
<div class="flex items-center justify-between ... gap-2">
  <!-- Contains tab-upnext and tab-christmas buttons -->
</div>
```

#### 5. Set Christmas as Default Tab (around line 2372)
In the JavaScript section, change the default tab from 'upnext' to 'christmas':
```javascript
// Change both instances of:
switchTab('upnext');

// To:
switchTab('christmas');

// And change the conditions from:
if (tabUpnext) {

// To:
if (tabChristmas && contentChristmas) {
```

### To Disable Holiday Mode

Reverse all the steps above:
1. Add `hidden` class back to snowflakes `<div>`
2. Add `hidden` class back to christmas lights `<ul>`
3. Add `hidden` class back to bg-video `<div>` and remove `hidden` from bg-static `<div>`
4. Hide the tab toggle, show the simple header bar
5. Change default tab back to 'upnext'

### Assets

**Non-holiday background:**
- Static blurred image from Unsplash: `photo-1657208431551-cbf415b8ef26`

**Holiday mode:**
- **Snowflakes**: Pure CSS animation (no external dependencies)
- **Christmas lights**: Pure CSS animation (no external dependencies)
- **Fireplace video**: YouTube embed ID `mSX3OyW9Rao`
- **Holiday playlist**: Embedded player from `player.acwebdev.net` (ID: `70454fd3`)
