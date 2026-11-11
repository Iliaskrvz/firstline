import type { IAuthenticateGeneric, Icon, ICredentialTestRequest, ICredentialType, INodeProperties } from 'n8n-workflow';

export class FirstLineApi implements ICredentialType {
	name = 'firstLineApi';

	displayName = 'FirstLine API';

	icon: Icon = { light: 'file:../icons/firstline.svg', dark: 'file:../icons/firstline.dark.svg' };

	documentationUrl = 'https://github.com/OWNER/n8n-nodes-firstline-email#credentials';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description: 'Create a key in FirstLine under Settings → API. It starts with fl_live_.',
		},
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://firstline.46-17-99-33.sslip.io',
			description: 'The address of your FirstLine app, without /api/v1',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl.replace(/\\/+$/, "")}}/api/v1',
			url: '/credits',
			method: 'GET',
		},
	};
}
