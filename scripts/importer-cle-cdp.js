// scripts/importer-cle-cdp.js — importe la cle CDP (Coinbase Developer Platform)
// dans le .env, en 2 temps.
//
// 1er lancement (npm run cle) : cree CLE_API_CDP.txt a la racine avec un
//   gabarit a completer, l'ouvre dans TextEdit, et s'arrete.
// 2eme lancement : lit CLE_API_CDP.txt, extrait Key ID + Secret (le secret
//   peut etre un bloc PEM multi-lignes), les ecrit dans .env, bascule
//   NETWORK sur "base", supprime CLE_API_CDP.txt, l'ajoute au .gitignore,
//   et confirme SANS jamais afficher le secret.
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const clePath = new URL("../CLE_API_CDP.txt", import.meta.url);
const envPath = new URL("../.env", import.meta.url);
const envExamplePath = new URL("../.env.example", import.meta.url);
const gitignorePath = new URL("../.gitignore", import.meta.url);

const MARKER_KEY_ID = "===== COLLE ICI LE KEY ID (une seule ligne) =====";
const MARKER_SECRET = "===== COLLE ICI LE SECRET (peut faire plusieurs lignes) =====";

const TEMPLATE = `${MARKER_KEY_ID}\n\n${MARKER_SECRET}\n\n`;

// --- 1er lancement : le fichier n'existe pas encore -------------------------

if (!existsSync(clePath)) {
  writeFileSync(clePath, TEMPLATE);
  spawn("open", ["-e", fileURLToPath(clePath)], { stdio: "ignore", detached: true }).unref();
  console.log(`Fichier cree : ${fileURLToPath(clePath)}`);
  console.log("Colle tes deux valeurs dans le fichier, enregistre, puis relance npm run cle");
  process.exit(0);
}

// --- 2eme lancement : le fichier existe, on l'importe -----------------------

const content = readFileSync(clePath, "utf8");

const idxKeyId = content.indexOf(MARKER_KEY_ID);
const idxSecret = content.indexOf(MARKER_SECRET);

if (idxKeyId === -1 || idxSecret === -1) {
  console.error(
    "CLE_API_CDP.txt ne contient plus les 2 marqueurs attendus.\n" +
      "Supprime le fichier et relance npm run cle pour repartir d'un gabarit propre."
  );
  process.exit(1);
}

const keyIdBlock = content.slice(idxKeyId + MARKER_KEY_ID.length, idxSecret);
const secretBlock = content.slice(idxSecret + MARKER_SECRET.length);

// Le Key ID doit tenir sur une seule ligne : on prend la 1ere ligne non vide.
const keyIdLines = keyIdBlock.split("\n").map((l) => l.trim()).filter(Boolean);
const keyId = keyIdLines[0] || "";
if (keyIdLines.length > 1) {
  console.warn(
    `Attention : plusieurs lignes trouvees sous le marqueur Key ID, seule la 1ere est utilisee ("${keyId}").`
  );
}

// Le secret peut etre multi-ligne (bloc PEM) : on garde les retours a la
// ligne internes, on retire juste le vide en debut/fin de bloc.
const secret = secretBlock.trim();

if (!keyId || !secret) {
  console.error(
    "CLE_API_CDP.txt est encore incomplet.\n" +
      "Colle le Key ID et le Secret aux bons endroits, enregistre, puis relance npm run cle."
  );
  process.exit(1);
}

// --- Ecriture dans .env ------------------------------------------------------

if (!existsSync(envPath)) {
  if (!existsSync(envExamplePath)) {
    console.error(".env et .env.example sont introuvables — impossible de continuer.");
    process.exit(1);
  }
  writeFileSync(envPath, readFileSync(envExamplePath, "utf8"));
}

// Echappe une valeur pour l'ecrire entre guillemets doubles dans un .env :
// dotenv convertit ensuite les \n litteraux en vrais retours a la ligne au
// chargement (verifie : config.js recoit alors le secret PEM intact).
function toDotenvDoubleQuoted(raw) {
  const normalized = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const escaped = normalized
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n");
  return `"${escaped}"`;
}

function upsertEnvVar(envContent, key, rawLine) {
  const re = new RegExp(`^${key}=.*$`, "m");
  const line = `${key}=${rawLine}`;
  if (re.test(envContent)) {
    return envContent.replace(re, line);
  }
  return envContent.replace(/\n*$/, "\n") + line + "\n";
}

let envContent = readFileSync(envPath, "utf8");
envContent = upsertEnvVar(envContent, "CDP_API_KEY_ID", toDotenvDoubleQuoted(keyId));
envContent = upsertEnvVar(envContent, "CDP_API_KEY_SECRET", toDotenvDoubleQuoted(secret));
envContent = upsertEnvVar(envContent, "NETWORK", "base");
writeFileSync(envPath, envContent);

// --- Nettoyage : supprime le fichier de cle, protege-le dans .gitignore -----

unlinkSync(clePath);

let gitignore = existsSync(gitignorePath) ? readFileSync(gitignorePath, "utf8") : "";
const alreadyIgnored = gitignore
  .split("\n")
  .some((l) => l.trim() === "CLE_API_CDP.txt");
if (!alreadyIgnored) {
  gitignore = gitignore.replace(/\n*$/, "\n") + "CLE_API_CDP.txt\n";
  writeFileSync(gitignorePath, gitignore);
}

// --- Confirmation, sans jamais afficher le secret ---------------------------

const secretLineCount = secret.split("\n").length;
console.log("Cle CDP importee avec succes.");
console.log(`  Key ID  : ${keyId}`);
console.log(
  `  Secret  : enregistre (bloc de ${secretLineCount} ligne${secretLineCount > 1 ? "s" : ""}, valeur masquee)`
);
console.log("  NETWORK : base (production)");
console.log("");
console.log("CLE_API_CDP.txt a ete supprime et ajoute au .gitignore.");
console.log(`Verifie le resultat dans ${fileURLToPath(new URL("../.env", import.meta.url))} si besoin.`);
