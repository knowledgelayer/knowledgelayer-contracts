import { ethers } from 'hardhat';
import {
  KnowledgeLayerID,
  KnowledgeLayerPlatformID,
  KnowledgeLayerCourse,
} from '../typechain-types';

export default async function deploy(): Promise<
  [KnowledgeLayerID, KnowledgeLayerPlatformID, KnowledgeLayerCourse]
> {
  const KnowledgeLayerPlatformID = await ethers.getContractFactory('KnowledgeLayerPlatformID');
  const knowledgeLayerPlatformId = await KnowledgeLayerPlatformID.deploy();
  await knowledgeLayerPlatformId.deployed();

  const KnowledgeLayerID = await ethers.getContractFactory('KnowledgeLayerID');
  const knowledgeLayerId = await KnowledgeLayerID.deploy(knowledgeLayerPlatformId.address);
  await knowledgeLayerId.deployed();

  const KnowledgeLayerCourse = await ethers.getContractFactory('KnowledgeLayerCourse');
  const knowledgeLayerCourse = await KnowledgeLayerCourse.deploy(knowledgeLayerId.address);
  await knowledgeLayerCourse.deployed();

  return [knowledgeLayerId, knowledgeLayerPlatformId, knowledgeLayerCourse];
}
