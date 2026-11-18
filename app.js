import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import {
  getDatabase, ref, get, onValue, runTransaction, update
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-database.js";

// Replace these values with the Firebase Web App configuration from Project settings.
const firebaseConfig = {
  apiKey: "AIzaSyDI_z8LjPmozHW8n7L4yRZ6-hztRdnVBLQ",
  authDomain: "boc-tham-cau-long.firebaseapp.com",
  databaseURL: "https://boc-tham-cau-long-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "boc-tham-cau-long",
  storageBucket: "boc-tham-cau-long.firebasestorage.app",
  messagingSenderId: "787098867951",
  appId: "1:787098867951:web:a77748ee863f9f6f00631a",
  measurementId: "G-LVHH8DPTPL"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

const $ = (id) => document.getElementById(id);
const loginPanel = $("loginPanel");
const drawPanel = $("drawPanel");
const loginForm = $("loginForm");
const loginMessage = $("loginMessage");
const drawButton = $("drawButton");
const slotDisplay = $("slotDisplay");
const drawStatus = $("drawStatus");
const bracketGrid = $("bracketGrid");
const bracketCanvas = $("bracketCanvas");
const viewport = $("bracketViewport");

let currentId = null;
let currentPlayer = null;
let drawIsOpen = false;
let slotsReady = false;
let zoom = 1;
let panX = 0;
let panY = 0;
let drag = null;

function setMessage(text = "") { loginMessage.textContent = text; }
function randomIndex(length) {
  if (!length) return -1;
  const random = new Uint32Array(1);
  crypto.getRandomValues(random);
  return random[0] % length;
}
function show(element) { element.classList.remove("hidden"); }
function hide(element) { element.classList.add("hidden"); }

// Firebase connection state is available at .info/connected.
onValue(ref(db, ".info/connected"), (snap) => {
  const connected = snap.val() === true;
  $("connectionStatus").textContent = connected ? "Live connection" : "Offline";
  $("connectionStatus").classList.toggle("online", connected);
});

onValue(ref(db, "tournament_config/isDrawOpen"), (snap) => {
  drawIsOpen = snap.val() === true;
  if (currentPlayer) refreshDrawControls();
});

// Keep the slot pools in the local cache. A transaction started with a cold
// cache can receive null and abort before the SDK contacts the server.
onValue(ref(db, "available_slots"), () => {
  slotsReady = true;
  if (currentPlayer) refreshDrawControls();
});

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const id = $("playerId").value.trim().toUpperCase();
  if (!id) return;
  setMessage("Checking player ID…");

  try {
    const snapshot = await get(ref(db, `players/${id}`));
    if (!snapshot.exists()) {
      setMessage("Player ID was not found. Please check with the organizer.");
      return;
    }
    currentId = id;
    currentPlayer = { id, ...snapshot.val() };
    renderPlayer();
    hide(loginPanel);
    show(drawPanel);
    setMessage("");
  } catch (error) {
    console.error(error);
    setMessage("Unable to connect to the tournament database.");
  }
});

$("logoutButton").addEventListener("click", () => {
  currentId = null;
  currentPlayer = null;
  hide(drawPanel);
  show(loginPanel);
  $("playerId").focus();
});

function renderPlayer() {
  $("playerName").textContent = currentPlayer.name || currentId;
  $("playerMeta").textContent = currentPlayer.isSeed ? "Seeded player" : "Normal draw pool";
  refreshDrawControls();
}

function refreshDrawControls() {
  const drawn = currentPlayer && currentPlayer.hasDrawn === true;
  const closed = !drawIsOpen && !drawn;
  const loading = !slotsReady;
  const closedNotice = $("drawClosedNotice");
  const already = $("alreadyDrawnNotice");

  closed ? show(closedNotice) : hide(closedNotice);
  if (drawn) {
    already.textContent = `Your slot is #${currentPlayer.slot}. The result is final.`;
    show(already);
    hide($("drawAction"));
  } else {
    hide(already);
    show($("drawAction"));
    drawButton.disabled = closed || loading;
    drawStatus.textContent = closed
      ? "The organizer has not opened the draw."
      : loading
        ? "Loading the slot pools…"
        : "Your slot is ready to be drawn.";
  }
}

drawButton.addEventListener("click", async () => {
  if (!currentId || !currentPlayer || !drawIsOpen || !slotsReady || currentPlayer.hasDrawn) return;

  // Disable before any asynchronous work to prevent accidental double clicks.
  drawButton.disabled = true;
  slotDisplay.classList.add("shuffling");
  drawStatus.textContent = "Shuffling the available slots…";

  const animation = setInterval(() => {
    slotDisplay.textContent = String(1 + Math.floor(Math.random() * 512));
  }, 85);

  try {
    // Keep the suspenseful animation visible for at least 2.4 seconds.
    await new Promise(resolve => setTimeout(resolve, 2400));
    clearInterval(animation);
    const slot = await reserveSlotAtomically(currentId, currentPlayer.isSeed === true);
    slotDisplay.textContent = String(slot);
    slotDisplay.classList.remove("shuffling");
    drawStatus.textContent = `Draw complete. Your slot is #${slot}.`;
    currentPlayer.slot = slot;
    currentPlayer.hasDrawn = true;
    refreshDrawControls();
  } catch (error) {
    clearInterval(animation);
    slotDisplay.classList.remove("shuffling");
    drawStatus.textContent = error.message || "The draw could not be completed.";
    drawButton.disabled = false;
  }
});

async function reserveSlotAtomically(playerId, isSeed) {
  const poolName = isSeed ? "seed_slots" : "normal_slots";
  const availableRef = ref(db, "available_slots");
  let reservedSlot = null;

  // This transaction serializes all simultaneous draws against the same node.
  // The onValue listener above keeps the local cache warm for the callback.
  const result = await runTransaction(availableRef, (data) => {
    if (!data || !Array.isArray(data[poolName]) || data[poolName].length === 0) return;
    const slots = [...data[poolName]];
    const index = randomIndex(slots.length);
    reservedSlot = Number(slots[index]);
    slots.splice(index, 1);
    return { ...data, [poolName]: slots };
  });

  if (!result.committed || reservedSlot === null) {
    throw new Error(`No ${isSeed ? "seed" : "normal"} slots remain.`);
  }

  // Protect the player record as well. A second tab for the same ID is rejected.
  const playerResult = await runTransaction(ref(db, `players/${playerId}`), (player) => {
    if (!player || player.hasDrawn === true) return;
    return { ...player, slot: reservedSlot, hasDrawn: true };
  });

  if (!playerResult.committed) {
    // Return the reservation if the player was already drawn elsewhere.
    await runTransaction(availableRef, (data) => {
      if (!data) return data;
      const slots = Array.isArray(data[poolName]) ? [...data[poolName]] : [];
      if (!slots.includes(reservedSlot)) slots.push(reservedSlot);
      return { ...data, [poolName]: slots };
    });
    throw new Error("This player already has a draw result.");
  }

  // Multi-path update at the database root makes the bracket entry visible immediately.
  await update(ref(db), {
    [`bracket_results/slot_${reservedSlot}`]: {
      playerId,
      name: playerResult.snapshot.val().name || playerId,
      isSeed
    }
  });
  return reservedSlot;
}

// Real-time bracket listener.
onValue(ref(db, "bracket_results"), (snapshot) => {
  const results = snapshot.val() || {};
  bracketGrid.replaceChildren();
  for (let slot = 1; slot <= 512; slot++) {
    const result = results[`slot_${slot}`];
    const number = document.createElement("div");
    number.className = "slot-number";
    number.textContent = `#${slot}`;

    const cell = document.createElement("div");
    cell.className = `slot-cell ${result ? "occupied" : "empty"}`;
    cell.title = result ? `${result.name} — slot ${slot}` : `Empty slot ${slot}`;
    cell.textContent = result ? result.name : "Empty / Bye";

    const round = document.createElement("div");
    round.className = "slot-tag";
    round.textContent = result ? (result.isSeed ? "SEED" : "DRAWN") : "BYE";
    bracketGrid.append(number, cell, round);
  }
});

function applyTransform() {
  bracketCanvas.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
  $("zoomValue").textContent = `${Math.round(zoom * 100)}%`;
}
function changeZoom(amount) {
  zoom = Math.max(.45, Math.min(2.2, zoom + amount));
  applyTransform();
}
$("zoomIn").addEventListener("click", () => changeZoom(.1));
$("zoomOut").addEventListener("click", () => changeZoom(-.1));
$("resetView").addEventListener("click", () => { zoom = 1; panX = 0; panY = 0; applyTransform(); });

viewport.addEventListener("pointerdown", (event) => {
  if (event.target.closest("button")) return;
  drag = { x: event.clientX, y: event.clientY, panX, panY };
  viewport.setPointerCapture(event.pointerId);
});
viewport.addEventListener("pointermove", (event) => {
  if (!drag) return;
  panX = drag.panX + event.clientX - drag.x;
  panY = drag.panY + event.clientY - drag.y;
  applyTransform();
});
viewport.addEventListener("pointerup", () => { drag = null; });
viewport.addEventListener("pointercancel", () => { drag = null; });

applyTransform();
