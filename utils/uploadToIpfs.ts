import { create } from 'ipfs-http-client';

const uploadToIPFS = async (data: Record<string, unknown>) => {
  try {
    const authorization = 'Basic ' + btoa(process.env.INFURA_ID + ':' + process.env.INFURA_SECRET);
    const ipfs = create({
      url: 'https://infura-ipfs.io:5001/api/v0',
      headers: {
        authorization,
      },
    });

    const result = await ipfs.add(JSON.stringify(data));
    return result.path;
  } catch (error) {
    console.error('IPFS error ', error);
  }
};

export default uploadToIPFS;
