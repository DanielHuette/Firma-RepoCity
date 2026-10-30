// Runs before the body is painted: marks that JavaScript is on, so the stylesheet can hide the
// stacked views until app.js has shown the one the address names. Without JavaScript every view
// stays visible one below the other.
document.documentElement.classList.add("js");
