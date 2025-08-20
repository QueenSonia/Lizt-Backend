"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@nestjs/core");
const config_1 = require("@nestjs/config");
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const helmet_1 = __importDefault(require("helmet"));
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const app_module_1 = require("./app.module");
const app_exceptions_filter_1 = require("./filters/app-exceptions-filter");
const express_1 = __importDefault(require("express"));
const options_cors_1 = require("./utils/options.cors");
async function bootstrap() {
    const app = await core_1.NestFactory.create(app_module_1.AppModule);
    const configService = app.get(config_1.ConfigService);
    const PORT = +(process.env.PORT ?? configService.get('PORT') ?? 3050);
    app.use(express_1.default.json({
        verify: (req, res, buf, encoding) => {
            const enc = (encoding || 'utf8');
            req['rawBody'] = buf.toString(enc);
        },
    }));
    app.enableCors(options_cors_1.corsOptions);
    app.use((0, helmet_1.default)());
    app.use((0, cookie_parser_1.default)());
    app.use(express_1.default.json({
        verify: (req, res, buf, encoding) => {
            const enc = (encoding || 'utf8');
            req['rawBody'] = buf.toString(enc);
        },
    }));
    app.useGlobalPipes(new common_1.ValidationPipe({
        whitelist: true,
        transform: true,
        errorHttpStatusCode: common_1.HttpStatus.UNPROCESSABLE_ENTITY,
    }));
    const { httpAdapter } = app.get(core_1.HttpAdapterHost);
    app.useGlobalFilters(new app_exceptions_filter_1.AppExceptionsFilter(httpAdapter));
    const swaggerConfig = new swagger_1.DocumentBuilder()
        .setTitle('Panda Homes')
        .setDescription('This service enables users access Panda Homes')
        .setVersion('1.0')
        .build();
    const document = swagger_1.SwaggerModule.createDocument(app, swaggerConfig);
    swagger_1.SwaggerModule.setup('documentationView', app, document);
    await app.listen(PORT, '0.0.0.0', () => {
        console.log(`🚀 Server running on port:: ${PORT}`);
    });
    return app;
}
void bootstrap();
//# sourceMappingURL=main.js.map