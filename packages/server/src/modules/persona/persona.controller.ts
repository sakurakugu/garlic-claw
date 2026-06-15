import { Body, Controller, Delete, Get, Param, Post, Put, Query, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { CurrentUser, JwtAuthGuard, Public } from '../auth/http-auth';
import { PersonaService } from './persona.service';
import { ActivateConversationPersonaDto } from './dto/activate-conversation-persona.dto';
import { CreatePersonaDto } from './dto/create-persona.dto';
import { UpdatePersonaDto } from './dto/update-persona.dto';

type UploadedPersonaAvatarFile = {
  buffer: Buffer;
  mimetype: string;
};

@Controller('personas')
export class PersonaController {
  constructor(
    private readonly personaService: PersonaService,
  ) {}

  @Get()
  async listPersonas() {
    return this.personaService.listPersonas();
  }

  @Get('current')
  @UseGuards(JwtAuthGuard)
  async getCurrentPersona(@CurrentUser('id') userId: string, @Query('conversationId') conversationId?: string) {
    const normalizedConversationId = typeof conversationId === 'string' && conversationId.trim() ? conversationId.trim() : null;
    return this.personaService.readCurrentPersona({
      context: {
        ...(normalizedConversationId ? { conversationId: normalizedConversationId } : {}),
        source: 'plugin',
        userId,
      },
      ...(normalizedConversationId ? { conversationId: normalizedConversationId } : {}),
    });
  }

  @Put('current')
  @UseGuards(JwtAuthGuard)
  async activateCurrentPersona(@CurrentUser('id') userId: string, @Body() dto: ActivateConversationPersonaDto) {
    return this.personaService.activatePersona({
      conversationId: dto.conversationId,
      personaId: dto.personaId,
      userId,
    });
  }

  @Post(':personaId/avatar')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  async uploadPersonaAvatar(@Param('personaId') personaId: string, @UploadedFile() file: UploadedPersonaAvatarFile | undefined) {
    if (!file) {
      throw new Error('No file uploaded');
    }
    this.personaService.savePersonaAvatar(personaId, file.buffer, file.mimetype);
    return { ok: true };
  }

  @Get(':personaId/avatar')
  @Public()
  async getPersonaAvatar(@Param('personaId') personaId: string, @Res() response: Response) {
    try {
      const avatarPath = this.personaService.readPersonaAvatarPath(personaId);
      response.sendFile(avatarPath);
    } catch {
      response.status(404).send('No avatar');
    }
  }

  @Get(':personaId')
  async getPersona(@Param('personaId') personaId: string) {
    return this.personaService.readPersona(personaId);
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  async createPersona(@Body() dto: CreatePersonaDto) {
    return this.personaService.createPersona(dto);
  }

  @Put(':personaId')
  @UseGuards(JwtAuthGuard)
  async updatePersona(@Param('personaId') personaId: string, @Body() dto: UpdatePersonaDto) {
    return this.personaService.updatePersona(personaId, dto);
  }

  @Delete(':personaId')
  @UseGuards(JwtAuthGuard)
  async deletePersona(@Param('personaId') personaId: string) {
    return this.personaService.deletePersona(personaId);
  }
}
