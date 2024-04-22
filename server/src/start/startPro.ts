import type {
	_Connection,
	Disposable,
	Hover,
	HoverParams,
	ServerRequestHandler,
} from 'vscode-languageserver';
import {
	statusBarNotification,
	phpstanProNotification,
} from '../lib/notificationChannels';
import type {
	ClassConfig,
	PromisedValue,
	WorkspaceFolders,
} from '../lib/types';
import { createHoverProvider } from '../providers/hoverProvider';
import type { ProviderArgs } from '../providers/providerUtil';
import { getEditorConfiguration } from '../lib/editorConfig';
import { Commands } from '../../../shared/commands/defs';
import { DocumentManager } from '../lib/documentManager';
import { launchPro } from '../lib/phpstan/pro/pro';
import { log, SERVER_PREFIX } from '../lib/log';

export async function startPro(
	classConfig: ClassConfig,
	connection: _Connection,
	disposables: Disposable[],
	onConnectionInitialized: Promise<void>,
	workspaceFolders: PromisedValue<WorkspaceFolders | null>
): Promise<{
	hoverProvider: ServerRequestHandler<
		HoverParams,
		Hover | undefined | null,
		never,
		void
	> | null;
}> {
	if (
		!(
			await getEditorConfiguration({
				connection,
				workspaceFolders,
			})
		).enabled
	) {
		void log(
			connection,
			SERVER_PREFIX,
			'Not starting pro since extension has been disabled'
		);
		return {
			hoverProvider: null,
		};
	}

	void connection.sendNotification(statusBarNotification, {
		type: 'fallback',
		text: 'PHPStan Pro starting...',
	});
	const pro = await launchPro(classConfig, (progress) => {
		void connection.sendNotification(statusBarNotification, {
			type: 'fallback',
			text: `PHPStan Pro starting ${progress.done}/${progress.total} (${progress.percentage}%)`,
		});
	});
	if (!pro.success()) {
		void connection.window.showErrorMessage(
			`Failed to start PHPStan Pro: ${pro.error ?? '?'}`
		);
		void connection.sendNotification(statusBarNotification, {
			type: 'fallback',
			text: undefined,
		});
	} else if (!(await pro.value.getPort())) {
		void connection.window.showErrorMessage(
			'Failed to find PHPStan Pro port'
		);
		void connection.sendNotification(statusBarNotification, {
			type: 'fallback',
			text: undefined,
		});
	} else {
		disposables.push(pro.value);
		const port = (await pro.value.getPort())!;
		void connection.sendNotification(phpstanProNotification, {
			type: 'setPort',
			port: port,
		});
		if (!(await pro.value.isLoggedIn())) {
			void connection.sendNotification(phpstanProNotification, {
				type: 'requireLogin',
			});
		}
		void connection.sendNotification(statusBarNotification, {
			type: 'fallback',
			text: 'PHPStan Pro running',
			command: Commands.OPEN_PHPSTAN_PRO,
		});
	}

	const documentManager = new DocumentManager(
		{
			connection: connection,
			workspaceFolders: workspaceFolders,
		},
		{
			onConnectionInitialized,
		}
	);
	disposables.push(documentManager);

	const providerArgs: ProviderArgs = {
		connection,
		hooks: classConfig.hooks.provider,
		workspaceFolders,
		onConnectionInitialized,
		documents: documentManager,
	};

	return {
		hoverProvider: createHoverProvider(providerArgs),
	};
}
