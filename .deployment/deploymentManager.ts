import fs from 'fs';

export const CONTRACT_NAMES = [
  'KnowledgeLayerID',
  'KnowledgeLayerPlatformID',
  'KnowledgeLayerCourse',
  'KnowledgeLayerEscrow',
] as const;

export type ContractName = (typeof CONTRACT_NAMES)[number];

const getFilename = (network: string) => `${__dirname}/${network}.json`;

const loadJSON = (network: string) => {
  const filename = getFilename(network);
  return fs.existsSync(filename) ? fs.readFileSync(filename).toString() : '{}';
};

const saveJSON = (network: string, json = '') => {
  const filename = getFilename(network);
  return fs.writeFileSync(filename, JSON.stringify(json, null, 2));
};

export const getDeploymentAddress = (network: string, contractName: ContractName): string => {
  const obj = JSON.parse(loadJSON(network));
  return obj[contractName] || 'Not found';
};

export const getDeployment = (network: string) => {
  const obj = JSON.parse(loadJSON(network));
  return obj || 'Not found';
};

export const setDeploymentAddress = (
  network: string,
  contractName: ContractName,
  value: string,
) => {
  const obj = JSON.parse(loadJSON(network) || '{}');
  obj[contractName] = value;
  saveJSON(network, obj);
};

export const removeDeploymentAddress = (network: string, contractName: ContractName) => {
  const obj = JSON.parse(loadJSON(network) || '{}');
  delete obj[contractName];
  saveJSON(network, obj);
};
