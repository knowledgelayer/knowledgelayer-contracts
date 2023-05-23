import { ethers } from 'hardhat';
import {
  KnowledgeLayerID,
  KnowledgeLayerPlatformID,
  KnowledgeLayerCourse,
  KnowledgeLayerEscrow,
  KnowledgeLayerReview,
} from '../typechain-types';

export default async function deploy(): Promise<
  [
    KnowledgeLayerID,
    KnowledgeLayerPlatformID,
    KnowledgeLayerCourse,
    KnowledgeLayerEscrow,
    KnowledgeLayerReview,
  ]
> {
  const [deployer] = await ethers.getSigners();

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
    knowledgeLayerPlatformId.address,
    knowledgeLayerCourse.address,
    deployer.address,
  );
  await knowledgeLayerEscrow.deployed();

  const escrowRole = await knowledgeLayerCourse.ESCROW_ROLE();
  await knowledgeLayerCourse.grantRole(escrowRole, knowledgeLayerEscrow.address);

  const KnowledgeLayerReview = await ethers.getContractFactory('KnowledgeLayerReview');
  const knowledgeLayerReview = await KnowledgeLayerReview.deploy(
    knowledgeLayerId.address,
    knowledgeLayerCourse.address,
  );
  await knowledgeLayerReview.deployed();

  return [
    knowledgeLayerId,
    knowledgeLayerPlatformId,
    knowledgeLayerCourse,
    knowledgeLayerEscrow,
    knowledgeLayerReview,
  ];
}
