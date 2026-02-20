import { $ } from 'bun';
import { createHash } from 'node:crypto';
import { chmodSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Signale } from 'signale';
import { extract } from 'tar';

const DRPC_RELEASE = 'https://github.com/AppleBlox/Discord-RPC-cli/releases/download/1.0.0/discord-rpc-cli';
const ALERTER_RELEASE = 'https://github.com/vjeantet/alerter/releases/download/1.0.1/alerter_v1.0.1_darwin_amd64.zip';

/** Verify SHA-256 hash of downloaded binary data */
async function verifyIntegrity(data: ArrayBuffer | Blob, expectedHash: string, name: string): Promise<void> {
	const buffer = data instanceof Blob ? Buffer.from(await data.arrayBuffer()) : Buffer.from(data);
	const hash = createHash('sha256').update(buffer).digest('hex');
	if (hash !== expectedHash) {
		throw new Error(
			`Integrity check failed for ${name}!\n` +
			`Expected: ${expectedHash}\n` +
			`Got:      ${hash}\n` +
			`The downloaded binary may have been tampered with. Aborting.`
		);
	}
}

export async function buildSidecar() {
	const logger = new Signale({ scope: 'sidecar' });

	const sidecarFiles: { name: string; filename: string; args: string[]; includeSuffix?: boolean; isSwift?: boolean }[] = [
		{
			name: 'Bootstrap',
			filename: 'bootstrap.m',
			args: ['-framework', 'Cocoa'],
		},
		{
			name: 'Urlscheme',
			filename: 'urlscheme.m',
			args: ['-framework', 'Foundation', '-framework', 'ApplicationServices'],
			includeSuffix: true,
		},
		{
			name: 'Window Manager',
			filename: 'window_manager.swift',
			args: [],
			includeSuffix: true,
			isSwift: true,
		}
	];

	await $`mkdir -p bin`;
	for (const file of sidecarFiles) {
		logger.await(`Compiling "${file.name}"`);
		const perf = performance.now();
		const outPath = resolve(join('bin', `${file.filename.split('.')[0]}${file.includeSuffix === true ? '_ablox' : ''}`));
		const filePath = resolve(join('scripts/build/sidecar', file.filename));
		let args: string[];
		if (file.isSwift) {
			args = ['swiftc', filePath, '-o', outPath];
		} else {
			args = [
				'gcc',
				'-Wno-deprecated-declarations',
				'-Wall',
				'-Wextra',
				'-mmacosx-version-min=10.13',
				'-arch',
				'x86_64',
				'-arch',
				'arm64',
				'-isysroot',
				'/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk',
				...file.args,
				filePath,
				'-o',
				outPath,
			];
		}
		await Bun.spawn(args).exited;

		logger.complete(`Compiled "${file.name} in ${((performance.now() - perf) / 1000).toFixed(3)}s`);
	}

	const drpcPath = resolve('bin/discordrpc_ablox');
	if (!(await Bun.file(drpcPath).exists())) {
		logger.info('Downloading DiscordRPC binary from repository releases...');
		const blob = await fetch(DRPC_RELEASE, { method: 'GET' }).then((res) => {
			if (!res.ok) throw new Error(`Failed to download DiscordRPC: HTTP ${res.status}`);
			return res.blob();
		});
		// TODO: Replace with actual SHA-256 hash from a trusted first download
		// Run: shasum -a 256 bin/discordrpc_ablox
		// await verifyIntegrity(blob, 'POPULATE_WITH_ACTUAL_HASH', 'discordrpc_ablox');
		logger.warn('Binary integrity verification is pending hash population for discordrpc_ablox');
		await Bun.write(drpcPath, blob);
		chmodSync(drpcPath, 0o755);
		logger.complete('Downloaded discordrpc_ablox.');
	}

	if (!(await Bun.file(resolve('bin/alerter_ablox')).exists())) {
		logger.info('Downloading Alerter binary from repository releases...');
		const arrayBuffer = await fetch(ALERTER_RELEASE, { method: 'GET' }).then((res) => {
			if (!res.ok) throw new Error(`Failed to download Alerter: HTTP ${res.status}`);
			return res.arrayBuffer();
		});
		// TODO: Replace with actual SHA-256 hash from a trusted first download
		// Run: shasum -a 256 <downloaded-archive>
		// await verifyIntegrity(arrayBuffer, 'POPULATE_WITH_ACTUAL_HASH', 'alerter');
		logger.warn('Binary integrity verification is pending hash population for alerter');
		const file = Buffer.from(arrayBuffer);

		const zipPath = resolve('bin/.temp/alerter.tar.gz');
		await $`mkdir -p ${resolve('bin/.temp')}`;
		await Bun.write(zipPath, file);
		await extract({
			file: zipPath,
			cwd: resolve('bin/'),
		});
		await $`mv bin/alerter bin/alerter_ablox`;

		logger.complete('Downloaded alerter_ablox.');
	}

	await $`rm -rf bin/.temp`;
}

if (import.meta.main) {
	buildSidecar();
}
