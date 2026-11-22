// Building a game, shared by the browser (main.js) and the headless runner (tools/headless.mjs).
// Pure: no rendering. The browser attaches its views between createGame() and generateMap().
import { Terrain } from './terrain.js';
import { World } from './world.js';
import { TrackNetwork } from './track.js';
import { Game } from './sim.js';
import { Waterways } from './ships.js';
import { mapSeeds } from './util.js';
import { useRules } from './data.js';

// seeds: from mapSeeds(map number), or a save's `seeds`
// rules: 'continental' (new games) or 'classic' (saves from before it)
export function createGame(seeds = mapSeeds(0), rules = 'continental') {
  useRules(rules);
  const terrain = new Terrain(seeds.terrain, seeds.map || 0, seeds.kind || 'classic');
  const world = new World(terrain, seeds.world);
  const net = new TrackNetwork(terrain, world);
  const game = new Game(world, net);
  return { terrain, world, net, game };
}

// generate the map: terrain, towns, industries, town layout, river navigation
export function generateMap({ terrain, world, game }) {
  world.generate();
  world.layout();
  const water = new Waterways(terrain); // (navigation uses the river as generated)
  game.water = water; world.water = water;
  game.frontier.start(); // (territories measured on the fresh map; a save overwrites them)
}

// the set-up of a new game (the URL options in the browser)
//   rivals 0..3 · difficulty easy|normal|hard · competition friendly|competitive|cutthroat
//   seed: varies the random streams (balance runs) · personalities: e.g. ['builder', 'financier']
export function newGame(game, { rivals = 2, difficulty = 'normal', seed = 0, personalities, competition } = {}) {
  if (seed) game.player.fin.rngState = 20261120 + seed * 7919;
  game.addRivals(Math.max(0, Math.min(3, rivals)), difficulty, { seed, personalities });
  if (competition === 'friendly' || competition === 'cutthroat') game.competition = competition;
}

// a game from a save (as made by game.serialize)
export function loadGame(save) {
  const seeds = save.seeds?.map || save.seeds?.kind ? { ...save.seeds, map: save.seeds.map || 0 } : mapSeeds(0);
  const g = createGame(seeds, save.rules || 'classic');
  generateMap(g);
  g.game.load(save);
  return g;
}
