/**
 * Required External Modules
 */

import * as dotenv from "dotenv";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import fileUpload, { UploadedFile } from "express-fileupload";
import morgan from "morgan";
import FileType from "file-type";
import { nanoid } from "nanoid";
import AWS from "aws-sdk";
import { FileExtension } from "file-type/core";

dotenv.config();

if (!process.env.PORT) {
  process.exit(1);
}

/**
 * App Variables
 */
const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.BUCKETS_REGION,
});
const PUBLIC_BUCKET = process.env.PUBLIC_BUCKET_NAME as string;
const PRIVATE_BUCKET = process.env.PRIVATE_BUCKET_NAME as string;
const ALLOWED_HOSTS = process.env.ALLOWED_HOSTS;
const app = express();
const port = process.env.PORT || 8000;
const apiPrefix = process.env.API_PREFIX;
/**
 *  App Configuration
 */
app.disable("x-powered-by");
app.use(
  fileUpload({
    createParentPath: true,
  })
);

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan("dev"));

/**
 * Routes
 */

app.post("/upload-image", async (req, res) => {
  const isPrivate = req.query?.type === "private";
  try {
    if (!req.files) {
      res.send({
        status: "error",
        message: "No file uploaded",
      });
    } else {
      //Use the name of the input field (i.e. "image") to retrieve the uploaded file
      let image = req.files.file as UploadedFile;
      const originalFilename = image.name.match(/(.+)\.(\w+)$/)![1];
      let filetype = (await FileType.fromBuffer(image.data)) || {
        ext: originalFilename as FileExtension,
        mime: "application/octet-stream",
      };
      const fileId = nanoid();

      const newFilename = `${fileId}.${filetype.ext}`;
      const bucket = isPrivate ? PRIVATE_BUCKET : PUBLIC_BUCKET;

      const params = {
        Bucket: bucket,
        Key: `${newFilename}`,
        Body: image.data,
        ContentLength: image.size,
        ContentType: image.mimetype,
        ACL: "public-read",
      };

      s3.upload(params)
        .promise()
        .then((s3Data) => {
          const location = isPrivate
            ? `/${apiPrefix}/image/${newFilename}`
            : s3Data.Location;
          res.json({
            status: "success",
            message: "File is uploaded",
            url: location,
            etag: s3Data.ETag,
            bytes: image.size,
            format: filetype.ext,
            mime: filetype.mime,
            original_filename: originalFilename,
            public_id: fileId,
            original_extension: filetype.ext,
          });
        })
        .catch((err) => {
          res.json({
            status: "error",
            error: err,
            message: "File upload error",
          });
        });
    }
  } catch (err) {
    console.log(err);
    res.status(500).send(err);
  }
});

app.get("/image/:imageName", async (req, res) => {
  const imageName = req.params.imageName;
  const params = {
    Bucket: PRIVATE_BUCKET!,
    Key: `${imageName}`,
  };
  try {
    await s3.headObject(params).promise();
  } catch (headErr) {
    if (headErr.code === "NotFound") {
      res.status(404).send({
        status: "error",
        message: "File not found",
      });
    }
    return;
  }

  s3.getObject(params).createReadStream().pipe(res);
});

app.delete("/image/:imageName", async (req, res) => {
  const imageName = req.params.imageName;
  const paramsPrivate = {
    Bucket: PRIVATE_BUCKET!,
    Key: `${imageName}`,
  };
  const paramsPublic = {
    Bucket: PUBLIC_BUCKET!,
    Key: `${imageName}`,
  };

  try {
    await s3.headObject(paramsPrivate).promise();
    s3.deleteObject(paramsPrivate, (err) => {
      if (err) {
        res.json({
          status: "error",
        });
      }
      res.json({ status: "success" });
    });
  } catch (headErr) {
    try {
      await s3.headObject(paramsPublic).promise();
      s3.deleteObject(paramsPublic, (err) => {
        if (err) {
          res.json({
            status: "error",
          });
        }
        res.json({ status: "success" });
      });
    } catch (headErr) {
      res.end();
      return;
    }
  }
});

app.get("/objects/list", async (req, res) => {
  try {
    const publicKeys = await listAllObjectsFromS3Bucket(PUBLIC_BUCKET);
    const privateKeys = await listAllObjectsFromS3Bucket(PRIVATE_BUCKET);
    res.json({
      publicKeys,
      privateKeys,
    });
  } catch (error) {
    res.json({
      status: "error",
      error,
    });
  }
});

app.listen(port, () =>
  console.log(`App is listening on port ${port}. Started at ${new Date()}`)
);

/**
 * (c) https://codingfundas.com/node.js-aws-sdk-how-to-list-all-the-keys-of-a-large-s3-bucket/
 *
 * Gets all filenames from public and provate bucket (if they located at bucket root)
 * @param bucket - string - Bucket name
 * @param prefix - Limits the response to keys that begin with the specified prefix.
 * @returns string[]
 */
async function listAllObjectsFromS3Bucket(bucket: string, prefix?: string): Promise<string[]> {
  const data: string[] = [];
  let isTruncated = true;
  let marker;
  while (isTruncated) {
    let params = { Bucket: bucket } as AWS.S3.ListObjectsRequest;
    if (prefix) params.Prefix = prefix;
    if (marker) params.Marker = marker;
    try {
      const response = await s3.listObjects(params).promise();
      if (response.Contents) {
        response.Contents.forEach((item) => {
          if (item.Key) {
            data.push(item.Key);
          }
        });
        isTruncated = !!response.IsTruncated;
        if (isTruncated) {
          marker = response.Contents.slice(-1)[0].Key;
        }
      }
    } catch (error) {
      throw error;
    }
  }
  return data;
}
