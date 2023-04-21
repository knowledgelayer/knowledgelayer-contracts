import { ethers } from 'hardhat';
import {
  KnowledgeLayerID,
  KnowledgeLayerPlatformID,
  KnowledgeLayerCourse,
  KnowledgeLayerEscrow,
} from '../typechain-types';

export default async function deploy(): Promise<
  [KnowledgeLayerID, KnowledgeLayerPlatformID, KnowledgeLayerCourse, KnowledgeLayerEscrow]
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

  const KnowledgeLayerEscrow = await ethers.getContractFactory('KnowledgeLayerEscrow');
  const knowledgeLayerEscrow = await KnowledgeLayerEscrow.deploy(
    knowledgeLayerId.address,
    knowledgeLayerCourse.address,
  );
  await knowledgeLayerEscrow.deployed();

  return [knowledgeLayerId, knowledgeLayerPlatformId, knowledgeLayerCourse, knowledgeLayerEscrow];
}
