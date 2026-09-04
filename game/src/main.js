import { Game } from './core/Game.js';

const canvas = document.getElementById('gl');
const game = new Game(canvas);
window.__BACKROOMS_GAME__ = game; // debugging hook only
game.start();
