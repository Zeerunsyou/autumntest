"use strict";

const STORAGE_KEY = "idlelock-settings-studio-v1";
const CONNECTION_KEY = "idlelock-settings-studio-connection-v1";
const DEFAULT_SETTINGS = Object.freeze({
	movement: "Walk",
	walkspeedenabled: false,
	walkspeed: 45,
	walkdynamic: false,
	walkspeed2: 1.5,
	tweenspeed: 6,
	jumpshortcuts: false,
	cannon: false,
});

const elements = {
	profileSelect: document.querySelector("#profile-select"),
	profileList: document.querySelector("#profile-list"),
	profileCount: document.querySelector("#profile-count"),
	modeInputs: [...document.querySelectorAll('input[name="movement-mode"]')],
	walkspeedEnabled: document.querySelector("#walkspeed-enabled"),
	walkspeed: document.querySelector("#walkspeed"),
	walkspeedOutput: document.querySelector("#walkspeed-output"),
	walkspeedSetting: document.querySelector("#walkspeed-setting"),
	dynamicSpeed: document.querySelector("#dynamic-speed"),
	multiplier: document.querySelector("#speed-multiplier"),
	multiplierOutput: document.querySelector("#multiplier-output"),
	multiplierSetting: document.querySelector("#multiplier-setting"),
	tweenSpeed: document.querySelector("#tween-speed"),
	tweenOutput: document.querySelector("#tween-output"),
	jumpShortcuts: document.querySelector("#jump-shortcuts"),
	useCannon: document.querySelector("#use-cannon"),
	summaryMovement: document.querySelector("#summary-movement"),
	summarySpeed: document.querySelector("#summary-speed"),
	summaryTween: document.querySelector("#summary-tween"),
	status: document.querySelector("#status-message"),
	importFile: document.querySelector("#import-file"),
	serverUrl: document.querySelector("#server-url"),
	serverKey: document.querySelector("#server-key"),
	syncStatus: document.querySelector("#sync-status"),
	robloxAccountId: document.querySelector("#roblox-account-id"),
	robloxSyncStatus: document.querySelector("#roblox-sync-status"),
	telemetryAccount: document.querySelector("#telemetry-account"),
	telemetryStatus: document.querySelector("#telemetry-status"),
	telemetryContent: document.querySelector("#telemetry-content"),
	telemetrySummary: document.querySelector("#telemetry-summary"),
	telemetryDetails: document.querySelector("#telemetry-details"),
};

function freshDefaults() {
	return { ...DEFAULT_SETTINGS };
}

function normalizeSettings(candidate) {
	if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
		throw new Error("A profile must contain a settings object.");
	}
	if (candidate.movement !== "Walk" && candidate.movement !== "Tween") {
		throw new Error("Movement style must be Walk or Tween.");
	}
	if (typeof candidate.walkspeedenabled !== "boolean" ||
		typeof candidate.walkdynamic !== "boolean" ||
		typeof candidate.jumpshortcuts !== "boolean" ||
		typeof candidate.cannon !== "boolean") {
		throw new Error("Profile toggles must be true or false.");
	}

	const speed = Number(candidate.walkspeed);
	const multiplier = Number(candidate.walkspeed2);
	const tweenSpeed = Number(candidate.tweenspeed);
	if (!Number.isFinite(speed) || speed < 30 || speed > 90 ||
		!Number.isFinite(multiplier) || multiplier < 1 || multiplier > 2 ||
		!Number.isFinite(tweenSpeed) || tweenSpeed < 1 || tweenSpeed > 12) {
		throw new Error("Speed values are outside their allowed ranges.");
	}
	return {
		movement: candidate.movement,
		walkspeedenabled: candidate.walkspeedenabled,
		walkspeed: Math.round(speed),
		walkdynamic: candidate.walkdynamic,
		walkspeed2: Math.round(multiplier * 10) / 10,
		tweenspeed: Math.round(tweenSpeed),
		jumpshortcuts: candidate.jumpshortcuts,
		cannon: candidate.cannon,
	};
}

function normalizeProfile(profile) {
	if (!profile || typeof profile.name !== "string" || !profile.name.trim()) {
		throw new Error("Each profile needs a name.");
	}
	return {
		id: typeof profile.id === "string" && profile.id ? profile.id : crypto.randomUUID(),
		name: profile.name.trim().slice(0, 40),
		settings: normalizeSettings(profile.settings),
	};
}

function loadState() {
	try {
		const saved = localStorage.getItem(STORAGE_KEY);
		if (!saved) {
			const initial = { activeId: "", profiles: [{ id: crypto.randomUUID(), name: "Default", settings: freshDefaults() }] };
			initial.activeId = initial.profiles[0].id;
			return initial;
		}
		const parsed = JSON.parse(saved);
		if (!parsed || !Array.isArray(parsed.profiles) || parsed.profiles.length === 0) {
			throw new Error("Saved data does not contain any profiles.");
		}
		const profiles = parsed.profiles.map(normalizeProfile);
		const activeId = profiles.some((profile) => profile.id === parsed.activeId) ? parsed.activeId : profiles[0].id;
		return { activeId, profiles };
	} catch (error) {
		throw new Error(`Could not load saved profiles: ${error.message}`);
	}
}

let state;
let telemetryState = { accounts: {} };
try {
	state = loadState();
} catch (error) {
	state = { activeId: "", profiles: [{ id: crypto.randomUUID(), name: "Default", settings: freshDefaults() }] };
	showStatus(error.message, true);
}

function activeProfile() {
	return state.profiles.find((profile) => profile.id === state.activeId);
}

function persist() {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
		return true;
	} catch (error) {
		showStatus(`Could not save profiles in this browser: ${error.message}`, true);
		return false;
	}
}

function showStatus(message, isError = false) {
	elements.status.textContent = message;
	elements.status.classList.toggle("error", isError);
}

function showSyncStatus(message, isError = false) {
	elements.syncStatus.textContent = message;
	elements.syncStatus.classList.toggle("error", isError);
}

function readConnection() {
	const endpoint = elements.serverUrl.value.trim().replace(/\/+$/, "");
	const key = elements.serverKey.value.trim();
	if (!endpoint) throw new Error("Enter the address of your Settings Studio host.");
	let parsed;
	try {
		parsed = new URL(endpoint);
	} catch {
		throw new Error("Enter a complete server address, such as http://192.168.1.20:8765.");
	}
	if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
		throw new Error("Use an HTTP or HTTPS server address without credentials or extra URL parts.");
	}
	if (!key) throw new Error("Enter the server access key.");
	return { endpoint, key };
}

function saveConnection(connection) {
	try {
		localStorage.setItem(CONNECTION_KEY, JSON.stringify(connection));
		return true;
	} catch (error) {
		showSyncStatus(`Could not save connection settings: ${error.message}`, true);
		return false;
	}
}

async function serverRequest(path, options = {}) {
	const connection = readConnection();
	saveConnection(connection);
	let response;
	try {
		response = await fetch(`${connection.endpoint}${path}`, {
			...options,
			headers: {
				"Authorization": `Bearer ${connection.key}`,
				...(options.body ? { "Content-Type": "application/json" } : {}),
				...options.headers,
			},
		});
	} catch (error) {
		throw new Error(`Could not reach the host. Check its address and that the server is running. (${error.message})`);
	}
	let result;
	try {
		result = await response.json();
	} catch {
		throw new Error(`The host returned an invalid response (HTTP ${response.status}).`);
	}
	if (!response.ok) throw new Error(result.error || `The host returned HTTP ${response.status}.`);
	return result;
}

function restoreConnection() {
	try {
		const saved = JSON.parse(localStorage.getItem(CONNECTION_KEY) || "null");
		if (saved && typeof saved.endpoint === "string" && typeof saved.key === "string") {
			elements.serverUrl.value = saved.endpoint;
			elements.serverKey.value = saved.key;
		} else if (location.protocol === "http:" || location.protocol === "https:") {
			elements.serverUrl.value = location.origin;
		}
	} catch (error) {
		showSyncStatus(`Could not load connection settings: ${error.message}`, true);
	}
}

function readSettings() {
	const selectedMode = elements.modeInputs.find((input) => input.checked);
	return normalizeSettings({
		movement: selectedMode ? selectedMode.value : "Walk",
		walkspeedenabled: elements.walkspeedEnabled.checked,
		walkspeed: elements.walkspeed.value,
		walkdynamic: elements.dynamicSpeed.checked,
		walkspeed2: elements.multiplier.value,
		tweenspeed: elements.tweenSpeed.value,
		jumpshortcuts: elements.jumpShortcuts.checked,
		cannon: elements.useCannon.checked,
	});
}

function renderSettings(settings) {
	const safe = normalizeSettings(settings);
	elements.modeInputs.forEach((input) => { input.checked = input.value === safe.movement; });
	elements.walkspeedEnabled.checked = safe.walkspeedenabled;
	elements.walkspeed.value = String(safe.walkspeed);
	elements.dynamicSpeed.checked = safe.walkdynamic;
	elements.multiplier.value = String(safe.walkspeed2);
	elements.tweenSpeed.value = String(safe.tweenspeed);
	elements.jumpShortcuts.checked = safe.jumpshortcuts;
	elements.useCannon.checked = safe.cannon;
	updatePresentation();
}

function updatePresentation() {
	elements.walkspeedOutput.value = elements.walkspeed.value;
	elements.multiplierOutput.value = `${Number(elements.multiplier.value).toFixed(1)}×`;
	elements.tweenOutput.value = elements.tweenSpeed.value;
	elements.walkspeedSetting.hidden = !elements.walkspeedEnabled.checked;
	elements.multiplierSetting.hidden = !elements.dynamicSpeed.checked;
	const selectedMode = elements.modeInputs.find((input) => input.checked);
	elements.summaryMovement.textContent = selectedMode ? selectedMode.value : "Walk";
	elements.summarySpeed.textContent = elements.walkspeed.value;
	elements.summaryTween.textContent = elements.tweenSpeed.value;
}

function renderProfiles() {
	elements.profileSelect.replaceChildren();
	elements.profileList.replaceChildren();
	for (const profile of state.profiles) {
		const option = document.createElement("option");
		option.value = profile.id;
		option.textContent = profile.name;
		option.selected = profile.id === state.activeId;
		elements.profileSelect.append(option);

		const button = document.createElement("button");
		button.type = "button";
		button.className = `profile-item${profile.id === state.activeId ? " active" : ""}`;
		button.setAttribute("aria-pressed", String(profile.id === state.activeId));
		button.innerHTML = `<span class="profile-symbol">◈</span><span><strong></strong><small></small></span>${profile.id === state.activeId ? '<span class="profile-check" aria-hidden="true">✓</span>' : ""}`;
		button.querySelector("strong").textContent = profile.name;
		button.querySelector("small").textContent = `${profile.settings.movement} · speed ${profile.settings.walkspeed}`;
		button.addEventListener("click", () => activateProfile(profile.id));
		elements.profileList.append(button);
	}
	elements.profileCount.textContent = String(state.profiles.length);
}

function activateProfile(id) {
	const profile = state.profiles.find((item) => item.id === id);
	if (!profile) {
		showStatus("That profile could not be found.", true);
		return;
	}
	state.activeId = id;
	renderSettings(profile.settings);
	renderProfiles();
	if (persist()) showStatus(`Loaded "${profile.name}".`);
}

function saveActiveProfile() {
	const profile = activeProfile();
	if (!profile) {
		showStatus("Select a profile before saving.", true);
		return;
	}
	try {
		profile.settings = readSettings();
		if (persist()) {
			renderProfiles();
			showStatus(`Saved "${profile.name}" in this browser.`);
		}
	} catch (error) {
		showStatus(error.message, true);
	}
}

function uniqueName(base) {
	let name = base;
	let index = 2;
	while (state.profiles.some((profile) => profile.name.toLowerCase() === name.toLowerCase())) {
		name = `${base} ${index++}`;
	}
	return name;
}

function createProfile(copyActive) {
	const name = window.prompt("Name your new profile:", uniqueName("New profile"));
	if (name === null) return;
	const trimmedName = name.trim().slice(0, 40);
	if (!trimmedName) {
		showStatus("Profile name cannot be empty.", true);
		return;
	}
	if (state.profiles.some((profile) => profile.name.toLowerCase() === trimmedName.toLowerCase())) {
		showStatus("A profile with that name already exists.", true);
		return;
	}
	const source = copyActive ? activeProfile().settings : freshDefaults();
	const profile = { id: crypto.randomUUID(), name: trimmedName, settings: { ...source } };
	state.profiles.push(profile);
	state.activeId = profile.id;
	renderSettings(profile.settings);
	renderProfiles();
	if (persist()) showStatus(`Created "${profile.name}".`);
}

function deleteActiveProfile() {
	if (state.profiles.length <= 1) {
		showStatus("Keep at least one profile in your workspace.", true);
		return;
	}
	const profile = activeProfile();
	if (!profile || !window.confirm(`Delete the "${profile.name}" profile from this browser?`)) return;
	state.profiles = state.profiles.filter((item) => item.id !== profile.id);
	state.activeId = state.profiles[0].id;
	renderSettings(activeProfile().settings);
	renderProfiles();
	if (persist()) showStatus(`Deleted "${profile.name}".`);
}

function exportProfiles() {
	try {
		const data = JSON.stringify({ format: "idlelock-settings-studio", version: 1, profiles: state.profiles }, null, 2);
		const url = URL.createObjectURL(new Blob([data], { type: "application/json" }));
		const link = document.createElement("a");
		link.href = url;
		link.download = "idlelock-profiles.json";
		link.click();
		URL.revokeObjectURL(url);
		showStatus("Exported profile backup.");
	} catch (error) {
		showStatus(`Could not export profiles: ${error.message}`, true);
	}
}

async function importProfiles(file) {
	try {
		const data = JSON.parse(await file.text());
		if (!data || data.format !== "idlelock-settings-studio" || !Array.isArray(data.profiles)) {
			throw new Error("This file is not a Settings Studio profile backup.");
		}
		const imported = data.profiles.map(normalizeProfile);
		if (imported.length === 0) throw new Error("The backup contains no profiles.");
		const names = new Set(state.profiles.map((profile) => profile.name.toLowerCase()));
		for (const profile of imported) {
			const baseName = profile.name;
			let candidate = baseName;
			let suffix = 2;
			while (names.has(candidate.toLowerCase())) candidate = `${baseName} ${suffix++}`;
			profile.name = candidate;
			names.add(profile.name.toLowerCase());
			profile.id = crypto.randomUUID();
		}
		state.profiles.push(...imported);
		state.activeId = imported[0].id;
		renderSettings(activeProfile().settings);
		renderProfiles();
		if (persist()) showStatus(`Imported ${imported.length} profile${imported.length === 1 ? "" : "s"}.`);
	} catch (error) {
		showStatus(`Could not import profiles: ${error.message}`, true);
	} finally {
		elements.importFile.value = "";
	}
}

async function connectToServer() {
	try {
		const result = await serverRequest("/api/health");
		showSyncStatus(result.message || "Connected to your Settings Studio host.");
		await refreshTelemetry();
	} catch (error) {
		showSyncStatus(error.message, true);
	}
}

function formatNumber(value) {
	if (typeof value !== "number" || !Number.isFinite(value)) return "—";
	return new Intl.NumberFormat().format(value);
}

function selectedTelemetryAccount() {
	const id = elements.telemetryAccount.value;
	return telemetryState.accounts[id] || null;
}

function appendTelemetryDetail(title, value) {
	if (value === undefined || value === null) return;
	const details = document.createElement("details");
	const summary = document.createElement("summary");
	const pre = document.createElement("pre");
	summary.textContent = title;
	pre.textContent = JSON.stringify(value, null, 2);
	details.append(summary, pre);
	elements.telemetryDetails.append(details);
}

function renderTelemetryAccount() {
	const id = elements.telemetryAccount.value;
	const account = selectedTelemetryAccount();
	elements.telemetrySummary.replaceChildren();
	elements.telemetryDetails.replaceChildren();
	if (!account) {
		elements.telemetryContent.hidden = true;
		elements.telemetryStatus.textContent = "No script data has reached this host yet. Configure the script's Dashboard API URL and key, enable its dashboard, then refresh.";
		elements.telemetryStatus.classList.remove("error");
		return;
	}
	elements.telemetryContent.hidden = false;
	elements.telemetryStatus.classList.remove("error");
	elements.telemetryStatus.textContent = `Showing account ${account.account?.roblox_account_name || id} · last received ${new Date((account.macro_stats_received_at || account.graph_received_at || account.account_received_at || 0) * 1000).toLocaleString()}`;
	const stats = account.macro_stats || {};
	const inventory = account.inventory?.inventory || {};
	const tiles = [
		["Honey", formatNumber(stats.honey)],
		["Honey / hour", formatNumber(stats.honey_per_hour)],
		["Session time", `${formatNumber(stats.macro_uptime_seconds)} sec`],
		["Inventory entries", formatNumber(Object.keys(inventory).length)],
	];
	for (const [label, value] of tiles) {
		const tile = document.createElement("div");
		const name = document.createElement("span");
		const amount = document.createElement("strong");
		tile.className = "telemetry-stat";
		name.textContent = label;
		amount.textContent = value;
		tile.append(name, amount);
		elements.telemetrySummary.append(tile);
	}
	appendTelemetryDetail("Macro stats & planters", account.macro_stats);
	appendTelemetryDetail("Honey graph", account.graph);
	appendTelemetryDetail("Inventory", account.inventory);
	appendTelemetryDetail("Hive state", account.hive_state);
	appendTelemetryDetail("Sticker index", account.sticker_index);
	appendTelemetryDetail("Recent logs", account.logs);
}

async function refreshTelemetry() {
	try {
		const result = await serverRequest("/api/telemetry");
		if (!result.accounts || typeof result.accounts !== "object" || Array.isArray(result.accounts)) {
			throw new Error("The host returned invalid dashboard data.");
		}
		telemetryState = result;
		const accountIds = Object.keys(telemetryState.accounts).sort();
		const previousId = elements.telemetryAccount.value;
		elements.telemetryAccount.replaceChildren();
		for (const id of accountIds) {
			const option = document.createElement("option");
			const account = telemetryState.accounts[id];
			option.value = id;
			option.textContent = account.account?.roblox_account_name ? `${account.account.roblox_account_name} (${id})` : id;
			elements.telemetryAccount.append(option);
		}
		elements.telemetryAccount.hidden = accountIds.length < 2;
		if (accountIds.includes(previousId)) elements.telemetryAccount.value = previousId;
		else if (accountIds.length > 0) elements.telemetryAccount.value = accountIds[0];
		renderTelemetryAccount();
	} catch (error) {
		elements.telemetryContent.hidden = true;
		elements.telemetryStatus.textContent = error.message;
		elements.telemetryStatus.classList.add("error");
		throw error;
	}
}

async function uploadProfiles() {
	try {
		const profile = activeProfile();
		if (!profile) throw new Error("Select a profile before uploading.");
		profile.settings = readSettings();
		if (!persist()) return;
		const result = await serverRequest("/api/profiles", {
			method: "PUT",
			body: JSON.stringify({ profiles: state.profiles }),
		});
		renderProfiles();
		showSyncStatus(result.message || `Uploaded ${state.profiles.length} profile${state.profiles.length === 1 ? "" : "s"}.`);
	} catch (error) {
		showSyncStatus(error.message, true);
	}
}

async function downloadProfiles() {
	try {
		const result = await serverRequest("/api/profiles");
		if (!Array.isArray(result.profiles) || result.profiles.length === 0) {
			throw new Error("The host does not have any saved profiles yet.");
		}
		const profiles = result.profiles.map(normalizeProfile);
		if (!window.confirm(`Replace your ${state.profiles.length} local profile${state.profiles.length === 1 ? "" : "s"} with ${profiles.length} profile${profiles.length === 1 ? "" : "s"} from the host?`)) return;
		state.profiles = profiles;
		state.activeId = profiles[0].id;
		renderSettings(activeProfile().settings);
		renderProfiles();
		if (persist()) showSyncStatus(`Downloaded ${profiles.length} profile${profiles.length === 1 ? "" : "s"} from the host.`);
	} catch (error) {
		showSyncStatus(error.message, true);
	}
}

function showRobloxSyncStatus(message, isError = false) {
	elements.robloxSyncStatus.textContent = message;
	elements.robloxSyncStatus.classList.toggle("error", isError);
}

function robloxConfigPath() {
	const accountId = elements.robloxAccountId.value.trim();
	if (!/^\d{1,20}$/.test(accountId)) throw new Error("Enter the numeric Roblox account ID.");
	return `/api/roblox-config/${accountId}`;
}

async function pushRobloxSettings() {
	try {
		const profile = activeProfile();
		if (!profile) throw new Error("Select a profile first.");
		profile.settings = readSettings();
		if (!persist()) return;
		const result = await serverRequest(robloxConfigPath(), {
			method: "POST",
			body: JSON.stringify({ settings: profile.settings }),
		});
		showRobloxSyncStatus(result.message || "Settings queued for the script.");
	} catch (error) {
		showRobloxSyncStatus(error.message, true);
	}
}

async function pullRobloxSettings() {
	try {
		const result = await serverRequest(robloxConfigPath());
		const profile = activeProfile();
		if (!profile) throw new Error("Select a profile first.");
		profile.settings = normalizeSettings(result.settings);
		renderSettings(profile.settings);
		if (persist()) showRobloxSyncStatus(`Loaded script settings into “${profile.name}”.`);
	} catch (error) {
		showRobloxSyncStatus(error.message, true);
	}
}

document.querySelector("#new-profile").addEventListener("click", () => createProfile(false));
document.querySelector("#duplicate-profile").addEventListener("click", () => createProfile(true));
document.querySelector("#delete-profile").addEventListener("click", deleteActiveProfile);
document.querySelector("#save-profile").addEventListener("click", saveActiveProfile);
document.querySelector("#reset-profile").addEventListener("click", () => {
	renderSettings(freshDefaults());
	showStatus("Defaults loaded. Save profile to keep these changes.");
});
document.querySelector("#export-profile").addEventListener("click", exportProfiles);
document.querySelector("#import-profile").addEventListener("click", () => elements.importFile.click());
document.querySelector("#connect-server").addEventListener("click", connectToServer);
document.querySelector("#upload-profiles").addEventListener("click", uploadProfiles);
document.querySelector("#download-profiles").addEventListener("click", downloadProfiles);
document.querySelector("#push-roblox-settings").addEventListener("click", pushRobloxSettings);
document.querySelector("#pull-roblox-settings").addEventListener("click", pullRobloxSettings);
document.querySelector("#refresh-telemetry").addEventListener("click", () => {
	refreshTelemetry().catch((error) => showSyncStatus(error.message, true));
});
elements.telemetryAccount.addEventListener("change", renderTelemetryAccount);
elements.importFile.addEventListener("change", () => {
	if (elements.importFile.files && elements.importFile.files[0]) importProfiles(elements.importFile.files[0]);
});
elements.profileSelect.addEventListener("change", () => activateProfile(elements.profileSelect.value));
[...elements.modeInputs, elements.walkspeedEnabled, elements.walkspeed, elements.dynamicSpeed, elements.multiplier, elements.tweenSpeed, elements.jumpShortcuts, elements.useCannon]
	.forEach((input) => input.addEventListener("input", updatePresentation));

renderProfiles();
renderSettings(activeProfile().settings);
restoreConnection();
