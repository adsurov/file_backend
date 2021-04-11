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
});
const BUCKET = process.env.BUCKET_NAME as string;
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
 * Server Activation
 */

app.post("/upload-image", async (req, res) => {
  try {
    if (!req.files) {
      res.send({
        status: 'error',
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

      console.log(filetype);
      const newFilename = `${fileId}.${filetype.ext}`;

      const params = {
        Bucket: BUCKET,
        Key: `public/${newFilename}`,
        Body: image.data,
        ContentLength: image.size,
        ContentType: image.mimetype,
        ACL: "public-read",
      };

      // image.mv("./files/" + image.name);
      s3.upload(params)
        .promise()
        .then((s3Data) => {
          res.json({
            status: "success",
            message: "File is uploaded",
            url: `/${apiPrefix}/image/${newFilename}`,
            // for direct link to S3 use following location
            // url: s3Data.Location,
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

      //send response

      // should return
      /**
       * Should return
       * url: string
       * bytes: number (file syze)
       * etag: string
       * format: string
       * original_filename: string
       * id: string
       *
       */
    }
  } catch (err) {
    console.log(err);
    res.status(500).send(err);
  }
});

app.get("/image/:imageName", (req, res) => {
  console.log("get image", req.params);
  const imageName = req.params.imageName;
  const file = s3
    .getObject({
      Bucket: BUCKET!,
      Key: `public/${imageName}`,
    })
    .createReadStream();
  file.pipe(res);
});

app.delete("/image/:imageName", (req, res) => {
  const imageName = req.params.imageName;
  s3.deleteObject(
    {
      Bucket: BUCKET!,
      Key: `public/${imageName}`,
    },
    (err) => {
      if (err) {
        res.json({
          status: "error",
        });
      }
      res.json({ status: "success" });
    }
  );
});

app.listen(port, () =>
  console.log(`App is listening on port ${port}. Started at ${new Date()}`)
);

function getFileName(string: string) {
  return string.split("/")[1];
}
