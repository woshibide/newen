import { bootstrapSingleCanvasPage } from './loader.js';

function getCanvasIdFromPage() {
    const value = document.body.dataset.canvasId;
    if (!value) {
        return null;
    }
    return value;
}

document.addEventListener('DOMContentLoaded', () => {
    const canvasId = getCanvasIdFromPage();
    if (!canvasId) {
        return;
    }

    bootstrapSingleCanvasPage(canvasId);
});