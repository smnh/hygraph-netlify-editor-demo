import _ from 'lodash';
import type * as StackbitTypes from '@stackbit/types';
import { GraphQLClient } from 'graphql-request';
import type { Query } from './gql-types';
import schemaQuery from './gql-queries/schema';
import type { ModelWithContext } from './hygraph-schema-converter';

export type HygraphDocument = {
    __typename: string;
    id: string;
    createdAt: string;
    createdBy: HygraphUser;
    updatedAt: string;
    updatedBy: HygraphUser;
    publishedAt: string | null;
    publishedBy: HygraphUser | null;
    stage: 'DRAFT' | 'PUBLISHED';
    documentInStages: {
        stage: 'PUBLISHED';
        updatedAt: string;
    }[];
    scheduledIn?: any[];
    history?: {
        id: string;
        createdAt: string;
        revision: number;
        stage: string;
    }[];
    [key: string]: any;
};

export type HygraphAsset = {
    __typename: string;
    id: string;
    createdAt: string;
    createdBy: HygraphUser;
    updatedAt: string;
    updatedBy: HygraphUser;
    stage: 'DRAFT' | 'PUBLISHED';
    documentInStages: {
        stage: 'PUBLISHED';
        updatedAt: string;
    }[];
    scheduledIn?: any[];
    url: string;
    fileName: string;
    handle: string;
    mimeType: string;
    size: number;
    width: number;
    height: number;
};

export type HygraphWebhook = {
    operation: 'create' | 'update' | 'publish' | 'unpublish' | 'delete';
    data: HygraphDocument | HygraphAsset;
};

export type HygraphUser = {
    id?: string;
};

export interface HygraphApiClientOptions {
    projectId: string;
    environment: string;
    contentApi: string;
    managementApi: string;
    managementToken: string;
    logger: StackbitTypes.Logger;
}

export class HygraphApiClient {
    private contentClient: GraphQLClient;
    private managementClient: GraphQLClient;
    private projectId: string;
    private environment: string;
    private logger: StackbitTypes.Logger;

    constructor(options: HygraphApiClientOptions) {
        this.projectId = options.projectId;
        this.environment = options.environment;
        this.logger = options.logger;
        this.contentClient = new GraphQLClient(options.contentApi);
        this.managementClient = new GraphQLClient(options.managementApi, {
            headers: {
                Authorization: `Bearer ${options.managementToken}`
            }
        });
    }

    async getSchema() {
        const result = await this.managementClient.request<Query>(schemaQuery, {
            projectId: this.projectId,
            environmentName: this.environment
        });

        const environment = result.viewer.project?.environment;
        return {
            models: environment?.contentModel.models ?? [],
            components: environment?.contentModel.components ?? [],
            enumerations: environment?.contentModel.enumerations ?? [],
            webhooks: environment?.webhooks ?? []
        };
    }

    async getDocuments(models: ModelWithContext[]): Promise<HygraphDocument[]> {
        const queryAst: any = { query: {} };
        const dataModels = models.filter((model) => model.type === 'data');
        const modelsByName = _.keyBy(models, 'name');
        for (const model of dataModels) {
            const queryModelName = toLowerCaseFirst(model.context!.pluralId);
            queryAst.query[queryModelName] = {
                __arguments: {
                    stage: 'DRAFT',
                    first: 100 // TODO: implement pagination
                },
                ...defaultDocumentQueryFields({
                    model,
                    getModelByName: (modelName: string) => modelsByName[modelName],
                    logger: this.logger
                })
            };
        }
        const query = convertASTToQuery(queryAst);
        try {
            const result = (await this.contentClient.request(query)) as Record<string, HygraphDocument[]>;
            return _.flatMap(result);
        } catch (error: any) {
            this.logger.warn(`Error fetching documents:\n${error.toString()}\nQuery:\n${query}`);
            return [];
        }
    }

    async getDocumentById({
        documentId,
        modelName,
        getModelByName
    }: {
        documentId: string;
        modelName: string;
        getModelByName: (modelName: string) => ModelWithContext | undefined;
    }): Promise<HygraphDocument | undefined> {
        const model = getModelByName(modelName);
        if (!model) {
            return undefined;
        }
        const queryModelName = toLowerCaseFirst(model.name);
        const queryAst = {
            query: {
                [queryModelName]: {
                    __arguments: {
                        stage: 'DRAFT',
                        where: { id: documentId }
                    },
                    ...defaultDocumentQueryFields({
                        model,
                        getModelByName,
                        logger: this.logger
                    })
                }
            }
        };
        const query = convertASTToQuery(queryAst);
        try {
            const result = (await this.contentClient.request(query)) as Record<string, HygraphDocument>;
            return result[queryModelName];
        } catch (error: any) {
            this.logger.warn(`Error fetching document:\n${error.toString()}\nQuery:\n${query}`);
            return undefined;
        }
    }

    async updateDocument({
        documentId,
        modelName,
        data
    }: {
        documentId: string;
        modelName: string;
        data: any;
    }): Promise<void> {
        const updateModelName = `update${modelName}`;
        const queryAst: any = {
            mutation: {
                [updateModelName]: {
                    __arguments: {
                        where: { id: documentId },
                        data: data
                    },
                    id: 1
                }
            }
        };
        const query = convertASTToQuery(queryAst);
        try {
            await this.contentClient.request(query);
        } catch (error: any) {
            this.logger.warn(`Error updating document:\n${error.toString()}\nQuery:\n${query}`);
            return undefined;
        }
    }

    async publishDocument({ documentId, modelName }: { documentId: string; modelName: string }): Promise<void> {
        const publishModelName = `publish${modelName}`;
        const queryAst: any = {
            mutation: {
                [publishModelName]: {
                    __arguments: {
                        where: { id: documentId },
                        to: 'PUBLISHED'
                    },
                    id: 1
                }
            }
        };
        const query = convertASTToQuery(queryAst);
        try {
            await this.contentClient.request(query);
        } catch (error: any) {
            this.logger.warn(`Error publishing document:\n${error.toString()}\nQuery:\n${query}`);
            return undefined;
        }
    }

    async unpublishDocument({ documentId, modelName }: { documentId: string; modelName: string }): Promise<void> {
        const publishModelName = `unpublish${modelName}`;
        const queryAst: any = {
            mutation: {
                [publishModelName]: {
                    __arguments: {
                        where: { id: documentId },
                        from: 'PUBLISHED'
                    },
                    id: 1
                }
            }
        };
        const query = convertASTToQuery(queryAst);
        try {
            await this.contentClient.request(query);
        } catch (error: any) {
            this.logger.warn(`Error unpublishing document:\n${error.toString()}\nQuery:\n${query}`);
            return undefined;
        }
    }

    async getAssets(): Promise<HygraphAsset[]> {
        const queryAst: any = {
            query: {
                assets: {
                    __arguments: {
                        stage: 'DRAFT',
                        first: 100 // TODO: implement pagination
                    },
                    ...defaultAssetQueryFields()
                }
            }
        };
        const query = convertASTToQuery(queryAst);
        try {
            const result = (await this.contentClient.request(query)) as { assets: HygraphAsset[] };
            return result.assets;
        } catch (error: any) {
            this.logger.warn(`Error fetching assets:\n${error.toString()}\nQuery:\n${query}`);
            return [];
        }
    }

    async getAssetById(assetId: string): Promise<HygraphAsset | undefined> {
        const queryAst: any = {
            query: {
                asset: {
                    __arguments: {
                        stage: 'DRAFT',
                        where: { id: assetId }
                    },
                    ...defaultAssetQueryFields()
                }
            }
        };
        const query = convertASTToQuery(queryAst);
        try {
            const result = (await this.contentClient.request(query)) as { asset: HygraphAsset };
            return result.asset;
        } catch (error: any) {
            this.logger.warn(`Error fetching asset:\n${error.toString()}\nQuery:\n${query}`);
            return undefined;
        }
    }
}

function defaultDocumentQueryFields(options: {
    model: ModelWithContext;
    getModelByName: (modelName: string) => ModelWithContext | undefined;
    logger: StackbitTypes.Logger;
}) {
    return {
        __typename: 1,
        id: 1,
        createdAt: 1,
        createdBy: { id: 1 },
        updatedAt: 1,
        updatedBy: { id: 1 },
        publishedAt: 1,
        publishedBy: { id: 1 },
        stage: 1,
        documentInStages: {
            __arguments: { stages: 'PUBLISHED' },
            stage: 1,
            updatedAt: 1
        },
        ...convertFieldsToQueryAST(options)
    };
}

function defaultAssetQueryFields() {
    return {
        __typename: 1,
        id: 1,
        createdAt: 1,
        createdBy: { id: 1 },
        updatedAt: 1,
        updatedBy: { id: 1 },
        stage: 1,
        documentInStages: {
            id: 1,
            stage: 1,
            publishedAt: 1,
            updatedAt: 1
        },
        url: 1,
        fileName: 1,
        handle: 1,
        mimeType: 1,
        size: 1,
        width: 1,
        height: 1
    };
}

function convertFieldsToQueryAST({
    model,
    getModelByName,
    visitedModelsCount = {},
    logger
}: {
    model: ModelWithContext;
    getModelByName: (modelName: string) => ModelWithContext | undefined;
    visitedModelsCount?: Record<string, number>;
    logger: StackbitTypes.Logger;
}): Record<string, any> {
    const fieldAst: Record<string, any> = {};
    for (const field of model.fields ?? []) {
        const fieldOrListItem = field.type === 'list' ? field.items : field;
        switch (fieldOrListItem.type) {
            case 'richText': {
                fieldAst[field.name] = {
                    __typename: 1,
                    markdown: 1,
                    text: 1
                };
                break;
            }
            case 'color': {
                fieldAst[field.name] = {
                    __typename: 1,
                    hex: 1
                };
                break;
            }
            case 'image': {
                fieldAst[field.name] = {
                    __typename: 1,
                    id: 1
                };
                break;
            }
            case 'model': {
                // TODO: fix issue with cyclic nesting and conflicts between
                //  similar named fields between different components
                const fieldInfo = model.context!.fieldInfo[field.name]!;
                const multiModelField =
                    fieldInfo.hygraphType === 'ComponentUnionField' || fieldInfo.hygraphType === 'UnionField';
                const singleModelField =
                    fieldInfo.hygraphType === 'ComponentField' ||
                    fieldInfo.hygraphType === 'UniDirectionalRelationalField' ||
                    fieldInfo.hygraphType === 'RelationalField';
                if (multiModelField) {
                    fieldAst[field.name] = {
                        __typename: 1,
                        __on: {
                            ...fieldOrListItem.models.reduce((accum: any, modelName) => {
                                const visitedCount = visitedModelsCount[modelName];
                                if (typeof visitedCount !== 'undefined' && visitedCount > 5) {
                                    return accum;
                                }
                                const model = getModelByName(modelName);
                                if (!model) {
                                    return accum;
                                }
                                accum[modelName] = convertFieldsToQueryAST({
                                    model,
                                    getModelByName,
                                    visitedModelsCount: {
                                        ...visitedModelsCount,
                                        [modelName]: (visitedModelsCount[modelName] ?? 0) + 1
                                    },
                                    logger
                                });
                                return accum;
                            }, {})
                        }
                    };
                } else if (fieldOrListItem.models.length === 1 && singleModelField) {
                    const modelName = fieldOrListItem.models[0]!;
                    const visitedCount = visitedModelsCount[modelName];
                    if (typeof visitedCount !== 'undefined' && visitedCount > 5) {
                        break;
                    }
                    const model = getModelByName(modelName);
                    if (model) {
                        fieldAst[field.name] = {
                            __typename: 1,
                            ...convertFieldsToQueryAST({
                                model,
                                getModelByName,
                                visitedModelsCount: {
                                    ...visitedModelsCount,
                                    [modelName]: (visitedModelsCount[modelName] ?? 0) + 1
                                },
                                logger
                            })
                        };
                    }
                }
                break;
            }
            case 'reference': {
                const fieldInfo = model.context!.fieldInfo[field.name]!;
                const multiModelField = fieldInfo.hygraphType === 'UnionField';
                const singleModelField =
                    fieldInfo.hygraphType === 'UniDirectionalRelationalField' ||
                    fieldInfo.hygraphType === 'RelationalField';
                if (multiModelField) {
                    fieldAst[field.name] = {
                        __typename: 1,
                        __on: {
                            ...fieldOrListItem.models.reduce((accum: any, modelName) => {
                                const model = getModelByName(modelName);
                                if (!model) {
                                    return accum;
                                }
                                accum[modelName] = {
                                    id: 1
                                };
                                return accum;
                            }, {})
                        }
                    };
                } else if (fieldOrListItem.models.length === 1 && singleModelField) {
                    fieldAst[field.name] = {
                        __typename: 1,
                        id: 1
                    };
                }
                break;
            }
            default: {
                fieldAst[field.name] = 1;
            }
        }
    }
    return fieldAst;
}

function toLowerCaseFirst(value: string): string {
    return value.charAt(0).toLowerCase() + value.slice(1);
}

function convertASTToQuery(queryAST: Record<string, any>, level?: never | 0): string;
function convertASTToQuery(queryAST: Record<string, any>, level: number): string[];
function convertASTToQuery(queryAST: Record<string, any>, level = 0): string | string[] {
    const indention = ' '.repeat(2 * level);
    const query: string[] = [];
    for (const [key, value] of Object.entries(queryAST)) {
        if (key === '__arguments') {
            continue;
        }
        if (key === '__on') {
            for (const [modelName, fields] of Object.entries(value as Record<string, any>)) {
                // open inline fragment
                query.push(`${indention}... on ${modelName} {`);
                // insert fragment fields
                query.push(...convertASTToQuery(fields, level + 1));
                // close inline fragment
                query.push(`${indention}}`);
            }
        } else if (_.isPlainObject(value)) {
            // open nested object
            if ('__arguments' in value) {
                const args = _.reduce(
                    value.__arguments,
                    (accum: string[], value: any, arg: string) => {
                        if (_.isPlainObject(value)) {
                            accum.push(`${arg}: ${serializeQueryArg(value)}`);
                        } else {
                            accum.push(`${arg}: ${value}`);
                        }
                        return accum;
                    },
                    []
                ).join(', ');
                query.push(`${indention}${key}(${args}) {`);
            } else {
                query.push(`${indention}${key} {`);
            }
            // insert object fields
            query.push(...convertASTToQuery(value, level + 1));
            // close object
            query.push(`${indention}}`);
        } else {
            query.push(`${indention}${key}`);
        }
    }
    return level === 0 ? query.join('\n') : query;
}

function serializeQueryArg(object: Record<string, any>) {
    const serialized = _.reduce(
        object,
        (result, value, key) => {
            if (_.isPlainObject(value)) {
                value = serializeQueryArg(value);
            } else if (typeof value === 'string') {
                value = `"${value}"`;
            }
            return result + (result.length ? ', ' : '') + `${key}: ${value}`;
        },
        ''
    );
    return `{ ${serialized} }`;
}
